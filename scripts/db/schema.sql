-- Application records are stored as JSONB to preserve nested inventory models.
-- Run explicitly during deployment, never on each request.
CREATE TABLE IF NOT EXISTS qore_documents (
  path text PRIMARY KEY,
  collection_path text NOT NULL,
  collection_id text NOT NULL,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS qore_documents_collection ON qore_documents(collection_path, path);
CREATE INDEX IF NOT EXISTS qore_documents_group ON qore_documents(collection_id, path);
CREATE INDEX IF NOT EXISTS qore_documents_company ON qore_documents(collection_path, (data->>'companyId'));
CREATE INDEX IF NOT EXISTS qore_documents_data ON qore_documents USING gin(data jsonb_path_ops);
CREATE TABLE IF NOT EXISTS qore_outbox (
 id bigserial PRIMARY KEY,
 path text NOT NULL,
 before_data jsonb,
 after_data jsonb,
 completed_handlers jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(),
 error text
);
CREATE INDEX IF NOT EXISTS qore_outbox_ready ON qore_outbox(available_at,id);
CREATE TABLE IF NOT EXISTS qore_job_runs (
 name text NOT NULL, slot text NOT NULL, completed boolean NOT NULL DEFAULT false,
 started_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(name,slot)
);
INSERT INTO qore_documents(path,collection_path,collection_id,data)
VALUES ('users/workspace','users','users','{"uid":"workspace","name":"Çalışma Alanı","role":"super_admin","companyId":"__legacy__","accessibleViews":[]}'::jsonb)
ON CONFLICT(path) DO NOTHING;
-- A lease works through Neon's transaction pooler; session advisory locks do not.
CREATE TABLE IF NOT EXISTS qore_worker_leases (
 name text PRIMARY KEY,
 owner text NOT NULL,
 expires_at timestamptz NOT NULL
);
