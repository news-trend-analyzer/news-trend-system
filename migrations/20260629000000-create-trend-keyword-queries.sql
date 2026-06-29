CREATE TABLE IF NOT EXISTS trend_keyword_queries (
  id BIGSERIAL PRIMARY KEY,
  keyword_id BIGINT NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  window_hours INTEGER NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  rank INTEGER NOT NULL,
  source_keyword VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL,
  search_query VARCHAR(255) NOT NULL,
  intent_summary TEXT,
  article_ids JSONB,
  generated_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_trend_keyword_queries_keyword_window_start
    UNIQUE (keyword_id, window_hours, period_start)
);

CREATE INDEX IF NOT EXISTS idx_trend_keyword_queries_active
  ON trend_keyword_queries (window_hours, generated_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_trend_keyword_queries_keyword_period
  ON trend_keyword_queries (keyword_id, period_start);
