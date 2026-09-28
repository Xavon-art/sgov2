-- A college, campus, or department is a single row that both describes what
-- kind of thing it is and acts as that place's Local Student Government, so
-- `department` joins the existing `college` and `campus` values here rather
-- than becoming a layer above or below them.

alter type public.unit_type add value if not exists 'department';
