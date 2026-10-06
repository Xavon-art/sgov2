-- A committee is a working group inside a council's government structure.
--
-- It joins the existing `unit_type` values rather than becoming a layer above or
-- below them, for the same reason `department` does in 00500: a committee is a
-- thing the org chart already knows how to draw, staff and parent. Making it a
-- value here rather than a table means every read that already walks
-- `governance_units` renders committees with no change, and every seat inside a
-- committee is an ordinary `unit_positions` row.
--
-- This file exists on its own because Postgres refuses to *use* a value added by
-- `alter type ... add value` in the same transaction that added it. The value is
-- committed here; the rows that use it are written by 02960.

alter type public.unit_type add value if not exists 'committee';