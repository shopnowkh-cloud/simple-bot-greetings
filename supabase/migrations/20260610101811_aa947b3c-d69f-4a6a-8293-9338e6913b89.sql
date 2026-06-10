UPDATE public.bot_state
SET value = jsonb_set(
  COALESCE(value, '{}'::jsonb),
  '{settings,CAMBO_API_TOKEN}',
  '"5002402843:lObaoQGGOXdmlkFTuh4yyKrIzaAvUGQ4nmL"'::jsonb,
  true
), updated_at = now()
WHERE key = 'db';