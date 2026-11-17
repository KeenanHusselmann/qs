-- Measuring on the drawing: a dimension line keeps the mark it was measured from.
--
-- The mark is the sheet, the page, the kind (length, area, count), the clicked points in the
-- sheet's own coordinates and the scale. It sits on the line it produced rather than in a table of
-- its own: the line is the measurement, and the mark is its evidence – clicking a line shows where
-- on the drawing it came from. Null on every line typed by hand.
--
-- Additive and replayable.
alter table "takeoff_dimensions" add column if not exists "mark" jsonb;
