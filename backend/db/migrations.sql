-- Migrações idempotentes (rodam a cada deploy, seguras de repetir).
-- Conduta/anti-abuso: strikes, bans e disputas por jogador.

CREATE TABLE IF NOT EXISTS player_conduct (
  player_id     uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  strikes       integer NOT NULL DEFAULT 0,       -- total histórico
  active_strikes integer NOT NULL DEFAULT 0,      -- nos últimos 30 dias (recalculado)
  last_strike_at timestamptz,
  disputes      integer NOT NULL DEFAULT 0,       -- partidas que caíram em disputa
  griefs        integer NOT NULL DEFAULT 0,       -- strikes por travar/não aceitar
  banned_until  timestamptz,                      -- fila bloqueada até aqui
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Log de cada strike (auditoria).
CREATE TABLE IF NOT EXISTS conduct_events (
  id          bigserial PRIMARY KEY,
  player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  match_id    uuid REFERENCES matches(id) ON DELETE SET NULL,
  kind        text NOT NULL,          -- 'grief' | 'dispute' | 'manual'
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conduct_events_player ON conduct_events (player_id, created_at);

-- Avaliação do oponente (like=+1, dislike=-1): reputação usada no desempate da
-- confirmação de vencedor. Uma opinião por par (a mais recente vale). Sem FK em
-- match_id de propósito (não bloquear o reset da ladder que trunca `matches`).
CREATE TABLE IF NOT EXISTS player_likes (
  from_id    uuid        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  to_id      uuid        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  value      smallint    NOT NULL,       -- +1 like, -1 dislike
  match_id   uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (from_id, to_id)
);
CREATE INDEX IF NOT EXISTS idx_player_likes_to ON player_likes (to_id);

-- Deck/Legend/champion jogado por cada jogador numa partida (base das estatísticas
-- estilo "campeão do LoL"). Legend/champion são públicos (ficam em jogo); o deck
-- completo só vem do próprio jogador (oponente é oculto). Sem FK em match_id de
-- propósito (não bloquear o reset da ladder).
CREATE TABLE IF NOT EXISTS match_decks (
  match_id      uuid        NOT NULL,
  format        text        NOT NULL,
  player_id     uuid        NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  legend_code   text,
  legend_name   text,
  champion_code text,
  champion_name text,
  deck          jsonb,
  self_reported boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_match_decks_legend ON match_decks (legend_code);
CREATE INDEX IF NOT EXISTS idx_match_decks_player ON match_decks (player_id);

-- Métricas: série temporal de snapshots (online, fila, partidas) p/ observabilidade.
CREATE TABLE IF NOT EXISTS metrics_snapshots (
  id             bigserial   PRIMARY KEY,
  at             timestamptz NOT NULL DEFAULT now(),
  online         integer     NOT NULL DEFAULT 0,
  queued_bo1     integer     NOT NULL DEFAULT 0,
  queued_bo3     integer     NOT NULL DEFAULT 0,
  active_matches integer     NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_metrics_at ON metrics_snapshots (at DESC);

-- Índice para o histórico de partidas do jogador (ORDER BY ended_at).
CREATE INDEX IF NOT EXISTS idx_matches_ended ON matches (ended_at DESC);

-- Relatos de problema/bug enviados pelos jogadores (botão "Relatar problema").
CREATE TABLE IF NOT EXISTS bug_reports (
  id         bigserial   PRIMARY KEY,
  player_id  uuid        REFERENCES players(id) ON DELETE SET NULL,
  message    text        NOT NULL,
  context    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bug_reports_at ON bug_reports (created_at DESC);
