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
//! The database uses WAL journal mode with fully synchronous commits so a
//! published resume offset never gets ahead of durably stored chunk data.

use cfms_core::Result;
use rusqlite::{Connection as SqliteConnection, OptionalExtension};
use std::path::{Path, PathBuf};

/// A single row from the chunks table.
#[derive(Debug, Clone)]
pub struct ChunkRow {
    pub idx: u32,
    pub prefix: [u8; 8],
    pub tag: [u8; 16],
    pub data: Vec<u8>,
}

const CHECKPOINT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TransferCheckpoint {
    pub file_size: u64,
    pub chunk_size: u32,
    pub total_chunks: u32,
    pub next_chunk: u32,
}

impl TransferCheckpoint {
    pub fn resume_offset(self) -> u64 {
        (self.next_chunk as u64 * self.chunk_size as u64).min(self.file_size)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResumeHint {
    pub offset: u64,
    pub chunk_size: u32,
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
    /// `synchronous=FULL` are set automatically.
    pub fn open(path: &Path) -> Result<Self> {
        let db = SqliteConnection::open(path)
            .map_err(|e| cfms_core::Error::Other(format!("failed to open chunk db: {e}")))?;

        db.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=FULL;
             CREATE TABLE IF NOT EXISTS chunks (
                 idx        INTEGER PRIMARY KEY,
                 prefix     BLOB NOT NULL,
                 tag        BLOB NOT NULL,
                 chunk_data BLOB NOT NULL
             );
             CREATE TABLE IF NOT EXISTS transfer_checkpoint (
                 singleton    INTEGER PRIMARY KEY CHECK (singleton = 1),
                 version      INTEGER NOT NULL,
                 file_size    INTEGER NOT NULL,
                 chunk_size   INTEGER NOT NULL,
                 total_chunks INTEGER NOT NULL,
                 next_chunk   INTEGER NOT NULL
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

    pub fn checkpoint(&self) -> Result<Option<TransferCheckpoint>> {
        self.db
            .query_row(
                "SELECT version, file_size, chunk_size, total_chunks, next_chunk
                 FROM transfer_checkpoint WHERE singleton = 1",
                [],
                |row| {
                    let version: u32 = row.get(0)?;
                    if version != CHECKPOINT_SCHEMA_VERSION {
                        return Err(rusqlite::Error::InvalidQuery);
                    }
                    let file_size: i64 = row.get(1)?;
                    if file_size < 0 {
                        return Err(rusqlite::Error::InvalidQuery);
                    }
                    Ok(TransferCheckpoint {
                        file_size: file_size as u64,
                        chunk_size: row.get(2)?,
                        total_chunks: row.get(3)?,
                        next_chunk: row.get(4)?,
                    })
                },
            )
            .optional()
            .map_err(|e| cfms_core::Error::Other(format!("checkpoint read failed: {e}")))
    }

    /// Return a safe resume hint from the protocol 20 checkpoint metadata.
    pub fn resume_hint(&self) -> Result<Option<ResumeHint>> {
        if let Some(checkpoint) = self.checkpoint()? {
            Self::validate_checkpoint_shape(checkpoint)?;
            self.validate_stored_prefix(checkpoint)?;
            return Ok(Some(ResumeHint {
                offset: checkpoint.resume_offset(),
                chunk_size: checkpoint.chunk_size,
            }));
        }
        Ok(None)
    }

    pub fn initialize_checkpoint(
        &self,
        expected: TransferCheckpoint,
    ) -> Result<TransferCheckpoint> {
        Self::validate_checkpoint_shape(expected)?;
        if let Some(existing) = self.checkpoint()? {
            if existing != expected {
                return Err(cfms_core::Error::Protocol(
                    "download checkpoint does not match server metadata".into(),
                ));
            }
            self.validate_stored_prefix(existing)?;
            return Ok(existing);
        }

        self.validate_stored_prefix(expected)?;
        let file_size = i64::try_from(expected.file_size).map_err(|_| {
            cfms_core::Error::Protocol("download file size exceeds SQLite range".into())
        })?;
        self.db
            .execute(
                "INSERT INTO transfer_checkpoint
                 (singleton, version, file_size, chunk_size, total_chunks, next_chunk)
                 VALUES (1, ?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![
                    CHECKPOINT_SCHEMA_VERSION,
                    file_size,
                    expected.chunk_size,
                    expected.total_chunks,
                    expected.next_chunk,
                ],
            )
            .map_err(|e| cfms_core::Error::Other(format!("checkpoint init failed: {e}")))?;
        Ok(expected)
    }

    fn validate_checkpoint_shape(checkpoint: TransferCheckpoint) -> Result<()> {
        if checkpoint.chunk_size == 0 || checkpoint.next_chunk > checkpoint.total_chunks {
            return Err(cfms_core::Error::Protocol(
                "invalid download checkpoint metadata".into(),
            ));
        }
        let expected_total = checkpoint.file_size.div_ceil(checkpoint.chunk_size as u64);
        if expected_total != checkpoint.total_chunks as u64 {
            return Err(cfms_core::Error::Protocol(
                "download checkpoint size metadata is inconsistent".into(),
            ));
        }
        Ok(())
    }

    fn validate_stored_prefix(&self, checkpoint: TransferCheckpoint) -> Result<()> {
        let mut stmt = self
            .db
            .prepare("SELECT idx, length(chunk_data) FROM chunks ORDER BY idx ASC")
            .map_err(|e| cfms_core::Error::Other(format!("checkpoint validation failed: {e}")))?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, u32>(0)?, row.get::<_, u32>(1)?)))
            .map_err(|e| cfms_core::Error::Other(format!("checkpoint validation failed: {e}")))?;
        let mut count = 0u32;
        for row in rows {
            let (index, length) =
                row.map_err(|e| cfms_core::Error::Other(format!("checkpoint row failed: {e}")))?;
            let expected_length = Self::expected_chunk_length(checkpoint, index)?;
            if index != count || index >= checkpoint.next_chunk || length != expected_length {
                return Err(cfms_core::Error::Protocol(
                    "stored download chunks are not a contiguous prefix".into(),
                ));
            }
            count += 1;
        }
        if count != checkpoint.next_chunk {
            return Err(cfms_core::Error::Protocol(
                "stored download chunk count does not match checkpoint".into(),
            ));
        }
        Ok(())
    }

    fn expected_chunk_length(checkpoint: TransferCheckpoint, index: u32) -> Result<u32> {
        if index >= checkpoint.total_chunks {
            return Err(cfms_core::Error::Protocol(
                "download chunk index exceeds checkpoint metadata".into(),
            ));
        }
        let offset = index as u64 * checkpoint.chunk_size as u64;
        Ok((checkpoint.file_size - offset).min(checkpoint.chunk_size as u64) as u32)
    }

    pub fn record_chunk(
        &mut self,
        idx: u32,
        prefix: &[u8; 8],
        tag: &[u8; 16],
        data: &[u8],
    ) -> Result<TransferCheckpoint> {
        let checkpoint = self.checkpoint()?.ok_or_else(|| {
            cfms_core::Error::Protocol("download checkpoint is not initialized".into())
        })?;
        if idx != checkpoint.next_chunk || idx >= checkpoint.total_chunks {
            return Err(cfms_core::Error::Protocol(format!(
                "unexpected chunk index {idx}; expected {}",
                checkpoint.next_chunk
            )));
        }
        let expected_length = Self::expected_chunk_length(checkpoint, idx)? as usize;
        if data.len() != expected_length {
            return Err(cfms_core::Error::Protocol(format!(
                "chunk {idx} has size {}, expected {expected_length}",
                data.len()
            )));
        }

        let tx = self
            .db
            .transaction()
            .map_err(|e| cfms_core::Error::Other(format!("chunk transaction failed: {e}")))?;
        tx.execute(
            "INSERT INTO chunks (idx, prefix, tag, chunk_data) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![idx, prefix.as_slice(), tag.as_slice(), data],
        )
        .map_err(|e| cfms_core::Error::Other(format!("chunk insert failed: {e}")))?;
        tx.execute(
            "UPDATE transfer_checkpoint SET next_chunk = ?1 WHERE singleton = 1",
            [idx + 1],
        )
        .map_err(|e| cfms_core::Error::Other(format!("checkpoint update failed: {e}")))?;
        tx.commit().map_err(|e| {
            cfms_core::Error::Other(format!("chunk transaction commit failed: {e}"))
        })?;

        Ok(TransferCheckpoint {
            next_chunk: idx + 1,
            ..checkpoint
        })
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

    #[test]
    fn record_chunk_advances_checkpoint_atomically() {
        let (mut store, _path) = make_store();
        let prefix = [0x11; 8];
        let tag = [0x22; 16];
        store
            .initialize_checkpoint(TransferCheckpoint {
                file_size: 20,
                chunk_size: 16,
                total_chunks: 2,
                next_chunk: 0,
            })
            .unwrap();

        let checkpoint = store.record_chunk(0, &prefix, &tag, &[0x33; 16]).unwrap();

        assert_eq!(checkpoint.next_chunk, 1);
        assert_eq!(checkpoint.resume_offset(), 16);
        assert_eq!(store.checkpoint().unwrap(), Some(checkpoint));
    }

    #[test]
    fn record_chunk_rejects_gaps_and_duplicates() {
        let (mut store, _path) = make_store();
        store
            .initialize_checkpoint(TransferCheckpoint {
                file_size: 32,
                chunk_size: 16,
                total_chunks: 2,
                next_chunk: 0,
            })
            .unwrap();
        let prefix = [0; 8];
        let tag = [0; 16];

        assert!(store.record_chunk(1, &prefix, &tag, &[0; 16]).is_err());
        store.record_chunk(0, &prefix, &tag, &[0; 16]).unwrap();
        assert!(store.record_chunk(0, &prefix, &tag, &[0; 16]).is_err());
    }

    #[test]
    fn chunks_without_protocol_checkpoint_are_not_resumable() {
        let (store, _path) = make_store();
        store.insert(0, &[0; 8], &[0; 16], &[0; 16]).unwrap();

        assert_eq!(store.resume_hint().unwrap(), None);
    }
}
