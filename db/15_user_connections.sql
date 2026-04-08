-- User connections table for storing external account integrations
CREATE TABLE IF NOT EXISTS user_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    connection_type VARCHAR(50) NOT NULL, -- 'broker', 'social', 'storage', 'api'
    name VARCHAR(255) NOT NULL,
    credentials JSONB, -- encrypted credentials stored as JSON
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'inactive', 'error'
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for quick lookups by user
CREATE INDEX IF NOT EXISTS idx_user_connections_user_id ON user_connections(user_id);

-- Index for connection type lookups
CREATE INDEX IF NOT EXISTS idx_user_connections_type ON user_connections(connection_type);
