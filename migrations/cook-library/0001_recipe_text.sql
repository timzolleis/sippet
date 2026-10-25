-- Search (cooking rule 9): one row per recipe that isn't trashed, rowid = recipe.rowid.
-- Trigram so German compounds match by substring; remove_diacritics so "ruehr" and "rühr" both find "verrühren".
CREATE VIRTUAL TABLE `recipe_text` USING fts5(title, ingredients, steps, tokenize = 'trigram remove_diacritics 1');
