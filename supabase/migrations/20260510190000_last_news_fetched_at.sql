-- Track when each project last had news fetched so ai-fetch-news-all can
-- skip recently-scanned projects and avoid burning Tavily credits on them.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS last_news_fetched_at TIMESTAMPTZ;
