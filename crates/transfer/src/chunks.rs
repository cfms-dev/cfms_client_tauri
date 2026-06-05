//! SQLite-backed temporary storage for encrypted file chunks.
//!
//! During a download, encrypted chunks arrive from the server and are
//! buffered in a local SQLite database.  Once all chunks have been received
//! and the AES key delivered, they are decrypted in order and written to
//! the target file.
//!
//! # Schema
//!
//! ```sql
//! CREATE TABLE chunks (
//!     idx        INTEGER PRIMARY KEY,
//!     prefix     BLOB NOT NULL,   -- 8 bytes
//!     tag        BLOB NOT NULL,   -- 16 bytes (GCM auth tag)
//!     chunk_data BLOB NOT NULL
//! );
//! ```
//!
//! The database uses WAL journal mode and disables synchronous writes for
//! maximum throughput during chunk ingestion.

use cfms_core::Result;
use rusqlite::Connection as SqliteConnection;
use std::path::{Path, PathBuf};

/// A single row from the chunks table.
#[derive(Debug, Clone)]
pub struct ChunkRow {
    pub idx: u32,
    pub prefix: [u8; 8],
    pub tag: [u8; 16],
    pub data: Vec<u8>,
}

/// Manages a SQLite database for temporary chunk storage.
pub struct ChunkStore {
    db: SqliteConnection,
    path: PathBuf,
}

impl ChunkStore {
    /// Open (or create) a chunk database at `path`.
    ///
    /// The file is created if it does not exist.  WAL mode and
    /// `synchronous=OFF` are set automatically.
    pub fn open(path: &Path) -> Result<Self> {
        let db = SqliteConnection::open(path)
            .map_err(|e| cfms_core::Error::Other(format!("failed to open chunk db: {e}")))?;

        db.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=OFF;
             CREATE TABLE IF NOT EXISTS chunks (
                 idx        INTEGER PRIMARY KEY,
                 prefix     BLOB NOT NULL,
                 tag        BLOB NOT NULL,
                 chunk_data BLOB NOT NULL
             );",
        )
        .map_err(|e| cfms_core::Error::Other(format!("failed to init chunk db: {e}")))?;

        Ok(Self {
            db,
            path: path.to_path_buf(),
        })
    }

    /// Insert (or replace) an encrypted chunk.
    pub fn insert(&self, idx: u32, prefix: &[u8; 8], tag: &[u8; 16], data: &[u8]) -> Result<()> {
        self.db
            .execute(
                "INSERT OR REPLACE INTO chunks (idx, prefix, tag, chunk_data) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![idx, prefix.as_slice(), tag.as_slice(), data],
            )
            .map_err(|e| cfms_core::Error::Other(format!("chunk insert failed: {e}")))?;
        Ok(())
    }

    /// Return all chunks ordered by index (ascending).
    pub fn ordered_chunks(&self) -> Result<Vec<ChunkRow>> {
        let mut chunks = Vec::new();
        self.for_each_ordered_chunk(|chunk| {
            chunks.push(chunk.clone());
            Ok(())
        })?;
        Ok(chunks)
    }

    /// Process chunks in index order without materializing the full set.
    ///
    /// Each row is read lazily from SQLite and passed to `f`.  This avoids
    /// allocating a `Vec` with every chunk simultaneously — peak memory is
    /// bounded by the size of *one* chunk plus the output buffer.
    pub fn for_each_ordered_chunk<F>(&self, mut f: F) -> Result<()>
    where
        F: FnMut(&ChunkRow) -> Result<()>,
    {
        let mut stmt = self
            .db
            .prepare("SELECT idx, prefix, tag, chunk_data FROM chunks ORDER BY idx ASC")
            .map_err(|e| cfms_core::Error::Other(format!("chunk query failed: {e}")))?;

        let rows = stmt
            .query_map([], |row| {
                let idx: u32 = row.get(0)?;

                let prefix_blob: Vec<u8> = row.get(1)?;
                let mut prefix = [0u8; 8];
                prefix.copy_from_slice(&prefix_blob);

                let tag_blob: Vec<u8> = row.get(2)?;
                let mut tag = [0u8; 16];
                tag.copy_from_slice(&tag_blob);

                let data: Vec<u8> = row.get(3)?;

                Ok(ChunkRow {
                    idx,
                    prefix,
                    tag,
                    data,
                })
            })
            .map_err(|e| cfms_core::Error::Other(format!("chunk row mapping failed: {e}")))?;

        for row in rows {
            let chunk = row.map_err(|e| cfms_core::Error::Other(format!("row error: {e}")))?;
            f(&chunk)?;
        }

        Ok(())
    }

    /// Flush pending writes to disk.
    pub fn commit(&self) -> Result<()> {
        self.db
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|e| cfms_core::Error::Other(format!("chunk commit failed: {e}")))?;
        Ok(())
    }

    /// Close the database and delete the file.
    ///
    /// Consumes `self` so no further operations are possible.
    pub fn purge(self) -> Result<()> {
        let path = self.path.clone();
        // Drop the connection to release the file handle.
        drop(self);
        if path.exists() {
            std::fs::remove_file(&path)?;
        }
        Ok(())
    }
}

impl Drop for ChunkStore {
    fn drop(&mut self) {
        // Best-effort checkpoint on drop.
        let _ = self.db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_store() -> (ChunkStore, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test_chunks.db");
        let store = ChunkStore::open(&path).unwrap();
        // Keep dir alive so the temp dir isn't deleted until the test ends.
        std::mem::forget(dir);
        (store, path)
    }

    #[test]
    fn insert_and_retrieve() {
        let (store, _path) = make_store();

        let prefix = [0x01u8; 8];
        let tag = [0xABu8; 16];
        let data = b"encrypted chunk data".to_vec();

        store.insert(0, &prefix, &tag, &data).unwrap();
        let chunks = store.ordered_chunks().unwrap();
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].idx, 0);
        assert_eq!(chunks[0].prefix, prefix);
        assert_eq!(chunks[0].tag, tag);
        assert_eq!(chunks[0].data, data);
    }

    #[test]
    fn ordered_chunks_sorted_by_idx() {
        let (store, _path) = make_store();
        let prefix = [0x00u8; 8];
        let tag = [0xCCu8; 16];

        // Insert out of order.
        store.insert(3, &prefix, &tag, b"d").unwrap();
        store.insert(1, &prefix, &tag, b"b").unwrap();
        store.insert(0, &prefix, &tag, b"a").unwrap();
        store.insert(2, &prefix, &tag, b"c").unwrap();

        let chunks = store.ordered_chunks().unwrap();
        assert_eq!(chunks.len(), 4);
        let data: Vec<Vec<u8>> = chunks.iter().map(|c| c.data.clone()).collect();
        assert_eq!(data, vec![b"a", b"b", b"c", b"d"]);
    }

    #[test]
    fn insert_replace_updates_existing() {
        let (store, _path) = make_store();
        let prefix = [0x00u8; 8];
        let tag = [0xDDu8; 16];

        store.insert(0, &prefix, &tag, b"old").unwrap();
        store.insert(0, &prefix, &tag, b"new").unwrap();

        let chunks = store.ordered_chunks().unwrap();
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].data, b"new");
    }
}
