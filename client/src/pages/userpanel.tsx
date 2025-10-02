import React, { useState } from "react";

// Theme colors (matching the existing UI)
const C = {
  bg: "#0B0C0E",
  panel: "#121317",
  border: "#2A2F36",
  text: "#E9EEF5",
  muted: "#9AA3B2",
  primary: "#6EFAFB",   // turquoise
  accent:  "#E2725B",   // terra cotta
  neutral: "#6E7E85",   // gray
};

// Tab component
interface TabProps {
  label: string;
  value: string;
  activeTab: string;
  onClick: (value: string) => void;
}

function Tab({ label, value, activeTab, onClick }: TabProps) {
  return (
    <button
      onClick={() => onClick(value)}
      className="px-4 py-2 font-medium"
      style={{
        color: activeTab === value ? C.primary : C.muted,
        borderBottom: activeTab === value ? `2px solid ${C.primary}` : '2px solid transparent',
        background: 'transparent'
      }}
    >
      {label}
    </button>
  );
}

// Card component
interface CardProps {
  children: React.ReactNode;
}

function Card({ children }: CardProps) {
  return (
    <div 
      className="p-4 rounded-md"
      style={{
        background: C.panel,
        border: `1px solid ${C.border}`
      }}
    >
      {children}
    </div>
  );
}

// Input component
interface InputProps {
  placeholder: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
}

function Input({ placeholder, value, onChange, type = "text" }: InputProps) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      className="w-full px-3 py-2 mt-2 rounded-md"
      style={{
        background: C.bg,
        color: C.text,
        border: `1px solid ${C.border}`
      }}
    />
  );
}

// Button component
interface ButtonProps {
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
}

function Button({ children, onClick, className = "" }: ButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 mt-4 rounded-md font-medium ${className}`}
      style={{
        background: C.primary,
        color: C.bg
      }}
    >
      {children}
    </button>
  );
}

// Workflow card component
interface WorkflowCardProps {
  name: string;
  description: string;
  status: 'active' | 'inactive' | 'error';
  lastRun?: string;
}

function WorkflowCard({ name, description, status, lastRun }: WorkflowCardProps) {
  const getStatusColor = () => {
    switch (status) {
      case 'active': return '#4CAF50';
      case 'inactive': return C.neutral;
      case 'error': return C.accent;
      default: return C.neutral;
    }
  };

  return (
    <div 
      className="p-4 mb-3 rounded-md"
      style={{
        background: C.bg,
        border: `1px solid ${C.border}`
      }}
    >
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-medium">{name}</h3>
        <span 
          className="px-2 py-1 text-xs rounded-full"
          style={{ 
            background: getStatusColor(),
            color: status === 'inactive' ? C.text : '#fff'
          }}
        >
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </span>
      </div>
      <p className="text-sm mb-2" style={{ color: C.muted }}>{description}</p>
      {lastRun && (
        <div className="text-xs" style={{ color: C.muted }}>
          Last run: {lastRun}
        </div>
      )}
    </div>
  );
}

export default function UserPanel() {
  const [activeTab, setActiveTab] = useState("accounts");
  const [account, setAccount] = useState("");
  const [accountType, setAccountType] = useState("broker");
  const [connected, setConnected] = useState(false);

  const connectAccount = () => {
    // TODO: send to backend securely
    console.log("Connecting account:", account);
    console.log("Account type:", accountType);
    
    // Show success message
    setConnected(true);
    setTimeout(() => setConnected(false), 3000);
  };

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden" style={{ background: C.bg, color: C.text }}>
      {/* Header */}
      <header className="flex items-center px-6 py-4 border-b" style={{ borderColor: C.border }}>
        <h1 className="text-2xl font-bold">User Dashboard</h1>
      </header>

      {/* Main content */}
      <div className="flex-1 p-6 overflow-auto">
        {/* Tabs */}
        <div className="flex border-b mb-6" style={{ borderColor: C.border }}>
          <Tab label="Accounts" value="accounts" activeTab={activeTab} onClick={setActiveTab} />
          <Tab label="Workflows" value="workflows" activeTab={activeTab} onClick={setActiveTab} />
          <Tab label="Settings" value="settings" activeTab={activeTab} onClick={setActiveTab} />
        </div>

        {/* Tab content */}
        <div className="grid gap-6">
          {activeTab === "accounts" && (
            <Card>
              <h2 className="text-lg font-semibold mb-4">Connect Accounts</h2>
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1" style={{ color: C.muted }}>
                  Account Type
                </label>
                <select
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value)}
                  className="w-full px-3 py-2 rounded-md"
                  style={{
                    background: C.bg,
                    color: C.text,
                    border: `1px solid ${C.border}`
                  }}
                >
                  <option value="broker">Broker</option>
                  <option value="social">Social Media</option>
                  <option value="storage">Cloud Storage</option>
                  <option value="api">Custom API</option>
                </select>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1" style={{ color: C.muted }}>
                  API Key or Token
                </label>
                <Input
                  placeholder="Enter account API key or token"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  type="password"
                />
                <p className="mt-1 text-xs" style={{ color: C.muted }}>
                  Your credentials are securely stored and never shared with third parties.
                </p>
              </div>
              <Button onClick={connectAccount}>Connect Account</Button>
              {connected && (
                <div className="mt-4 p-2 rounded-md" style={{ background: "rgba(110, 250, 251, 0.1)" }}>
                  <p style={{ color: C.primary }}>Account connected successfully!</p>
                </div>
              )}
              
              <div className="mt-6">
                <h3 className="font-medium mb-3">Connected Accounts</h3>
                <div 
                  className="p-3 rounded-md mb-2 flex justify-between items-center"
                  style={{
                    background: C.bg,
                    border: `1px solid ${C.border}`
                  }}
                >
                  <div>
                    <div className="font-medium">Trading Account</div>
                    <div className="text-xs" style={{ color: C.muted }}>Connected 3 days ago</div>
                  </div>
                  <button 
                    className="text-xs px-2 py-1 rounded"
                    style={{ 
                      background: 'transparent', 
                      border: `1px solid ${C.accent}`,
                      color: C.accent
                    }}
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            </Card>
          )}

          {activeTab === "workflows" && (
            <Card>
              <h2 className="text-lg font-semibold mb-4">Your Workflows</h2>
              <WorkflowCard 
                name="Daily Market Analysis" 
                description="Analyzes market trends and sends a daily report at 8 AM"
                status="active"
                lastRun="Today, 8:00 AM"
              />
              <WorkflowCard 
                name="Social Media Monitor" 
                description="Monitors Twitter for mentions of selected stocks"
                status="active"
                lastRun="10 minutes ago"
              />
              <WorkflowCard 
                name="Portfolio Rebalance" 
                description="Automatically rebalances portfolio based on predefined rules"
                status="inactive"
              />
              <WorkflowCard 
                name="News Alert" 
                description="Sends alerts for breaking news related to your watchlist"
                status="error"
                lastRun="Yesterday, 3:45 PM"
              />
              
              <Button onClick={() => console.log("Create workflow")}>Create New Workflow</Button>
            </Card>
          )}

          {activeTab === "settings" && (
            <Card>
              <h2 className="text-lg font-semibold mb-4">Profile Settings</h2>
              
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1" style={{ color: C.muted }}>
                  Display Name
                </label>
                <Input
                  placeholder="Your display name"
                  value="John Doe"
                  onChange={() => {}}
                />
              </div>
              
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1" style={{ color: C.muted }}>
                  Email
                </label>
                <Input
                  placeholder="Your email address"
                  value="john.doe@example.com"
                  onChange={() => {}}
                />
              </div>
              
              <div className="mb-6">
                <label className="block text-sm font-medium mb-1" style={{ color: C.muted }}>
                  Notification Preferences
                </label>
                <div className="mt-2">
                  <label className="flex items-center mb-2">
                    <input 
                      type="checkbox" 
                      checked={true} 
                      onChange={() => {}}
                      className="mr-2"
                    />
                    <span>Email notifications</span>
                  </label>
                  <label className="flex items-center mb-2">
                    <input 
                      type="checkbox" 
                      checked={true} 
                      onChange={() => {}}
                      className="mr-2"
                    />
                    <span>Push notifications</span>
                  </label>
                  <label className="flex items-center">
                    <input 
                      type="checkbox" 
                      checked={false} 
                      onChange={() => {}}
                      className="mr-2"
                    />
                    <span>SMS notifications</span>
                  </label>
                </div>
              </div>
              
              <Button onClick={() => console.log("Save settings")}>Save Settings</Button>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
