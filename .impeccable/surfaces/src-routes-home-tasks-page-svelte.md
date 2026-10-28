---
version: 1
slug: "src-routes-home-tasks-page-svelte"
primary_target: "src/routes/home/tasks/+page.svelte"
related_targets: ["src/routes/home/schedules/+page.svelte", "src/lib/components/TaskActionButton.svelte", "src/lib/components/ScheduleEditor.svelte"]
---

# Transfers and schedules

- Mode: Operate. Review progress and recover ongoing or failed transfers; configure permitted schedules.
- Authority: DESIGN.md. Shared Fluent actions, readable Noto status/data typography, fixed type ramp, compact progress rows and explicit error/warning states.
- Preserve pause/resume/cancel/retry, grouped transfers, batching, conflict decisions, direct-ID downloads and schedule semantics. Filters/tabs stay keyboard operable and narrow tab strips scroll.
- Virtual list keyboard targets include native and Fluent actions; remeasure variable rows when fonts load. Coarse-pointer controls remain at least 44px.
- Transfer headings have 24px top spacing, reduced to 16px below 520px; titles use 28/36px, descriptions 14/20px with a 4px gap. Refresh uses an Arrow Clockwise icon button aligned with the title. Descriptions remain visible on narrow windows.
- Implementation/validation inventory: FLUENT-MIGRATION.md.
- Schedule header commands stay grouped at the right in DOM and visual order: New schedule, availability help when applicable, then Refresh. Narrow windows move the group below the heading and keep Refresh at its right edge.

- Upload execution belongs to the backend queue. A selection is a durable batch; mounted file views refresh independently after completion. Transfer rows never own worker lifetimes.
- Both tabs support batch selection and selecting all matching tasks across virtual rows. Bulk controls target selected IDs, otherwise the filtered set; changing filters clears selection. Narrow upload batches place secondary controls in the shared context menu.
- History cleanup preserves files. Stop-and-clear confirms its scope and waits for worker exit, retaining failures and timeouts with a consolidated result. In-flight folder producers close admission before their records are removed.
