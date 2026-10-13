-- RiftAtlas Ranked — schema PostgreSQL
-- Dois rankings independentes por formato: 'bo1' (Md1) e 'bo3' (Md3).
-- Todo rating/fila/leaderboard é SEMPRE escopado por `format`.

BEGIN;

-- Formatos suportados (único eixo de separação dos rankings).
CREATE TYPE match_format AS ENUM ('bo1', 'bo3');

-- Estados possíveis de uma entrada de fila.
CREATE TYPE queue_status AS ENUM ('waiting', 'matched', 'cancelled');

-- Motivo de encerramento de uma partida.
CREATE TYPE result_reason AS ENUM (
  'score',          -- alguém atingiu o Victory Score
  'concession',     -- desistência / saiu da sala
  'walkover',       -- W.O.: oponente abandonou e não voltou no grace
  'double_no_show', -- ambos sumiram sem estado final (anula)
  'disputed'        -- relatos divergem -> revisão manual
);

-- ---------------------------------------------------------------------------
-- Jogadores (identidade; 1 linha por conta Clerk)
-- ---------------------------------------------------------------------------
CREATE TABLE players (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id     text UNIQUE NOT NULL,          -- window.Clerk.user.id
  riftatlas_plr_id  text,                           -- plr_xxxx interno (lido da URL do WS)
  display_name      text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  banned            boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_players_plr ON players (riftatlas_plr_id);

-- ---------------------------------------------------------------------------
-- Rating por formato (estado Glicko-2). 2 linhas por jogador (bo1 + bo3),
-- criadas sob demanda na primeira partida ranqueada daquele formato.
-- ---------------------------------------------------------------------------
CREATE TABLE player_ratings (
  player_id          uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  format             match_format NOT NULL,
  -- Glicko-2 (escala humana; conversão p/ interna fica no motor)
  rating             double precision NOT NULL DEFAULT 1500,
  rd                 double precision NOT NULL DEFAULT 350,   -- rating deviation
  vol                double precision NOT NULL DEFAULT 0.06,  -- volatility (σ)
  last_rated_at      timestamptz,                             -- p/ decaimento de RD
  games_played       integer NOT NULL DEFAULT 0,              -- p/ marcar "provisório"
  wins               integer NOT NULL DEFAULT 0,
  losses             integer NOT NULL DEFAULT 0,
  walkovers_for      integer NOT NULL DEFAULT 0,              -- W.O. a favor
  walkovers_against  integer NOT NULL DEFAULT 0,              -- abandonos (W.O. contra)
  PRIMARY KEY (player_id, format)
);
-- Leaderboard por formato: ordena por rating desc (só quem já saiu do provisório
-- pode ser filtrado na query, ex.: rd < 100).
CREATE INDEX idx_ratings_leaderboard ON player_ratings (format, rating DESC);

-- ---------------------------------------------------------------------------
-- Fila (uma fila lógica por formato)
-- ---------------------------------------------------------------------------
CREATE TABLE queue_entries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id        uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  format           match_format NOT NULL,
  enqueued_at      timestamptz NOT NULL DEFAULT now(),
  rating_snapshot  double precision NOT NULL,       -- MMR do formato ao entrar
  status           queue_status NOT NULL DEFAULT 'waiting'
);
-- Busca de pares: fila do formato, mais antigos primeiro.
CREATE INDEX idx_queue_matching ON queue_entries (format, status, enqueued_at);
-- Um jogador não pode estar duas vezes na mesma fila aguardando.
CREATE UNIQUE INDEX uq_queue_one_waiting
  ON queue_entries (player_id, format)
  WHERE status = 'waiting';

-- ---------------------------------------------------------------------------
-- Partidas
-- ---------------------------------------------------------------------------
CREATE TABLE matches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  format         match_format NOT NULL,
  player_a       uuid NOT NULL REFERENCES players(id),   -- host (cria a sala)
  player_b       uuid NOT NULL REFERENCES players(id),   -- joiner
  room_code      text,                                   -- lido do RiftAtlas
  state          text NOT NULL,                          -- máquina de estados (ARQUITETURA §6)
  created_at     timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  ended_at       timestamptz,
  -- placar da série (bo3 vai até 2; bo1 até 1)
  games_won_a    integer NOT NULL DEFAULT 0,
  games_won_b    integer NOT NULL DEFAULT 0,
  -- resultado final
  winner_id      uuid REFERENCES players(id),            -- null até resolver
  result_reason  result_reason,
  report_a       jsonb,                                   -- relato bruto da extensão A
  report_b       jsonb,                                   -- relato bruto da extensão B
  rating_delta   jsonb,                                   -- snapshot antes/depois (auditoria)
  CONSTRAINT different_players CHECK (player_a <> player_b)
);
CREATE INDEX idx_matches_room ON matches (room_code);
CREATE INDEX idx_matches_player_a ON matches (player_a);
CREATE INDEX idx_matches_player_b ON matches (player_b);

-- ---------------------------------------------------------------------------
-- Histórico de rating (auditoria + gráfico de evolução), por formato
-- ---------------------------------------------------------------------------
CREATE TABLE rating_history (
  id             bigserial PRIMARY KEY,
  player_id      uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  match_id       uuid REFERENCES matches(id) ON DELETE SET NULL,
  format         match_format NOT NULL,
  rating_before  double precision NOT NULL,
  rd_before      double precision NOT NULL,
  vol_before     double precision NOT NULL,
  rating_after   double precision NOT NULL,
  rd_after       double precision NOT NULL,
  vol_after      double precision NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_history_player ON rating_history (player_id, format, created_at);

COMMIT;
