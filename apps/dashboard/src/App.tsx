import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, authToken } from "./api.js";
import { connectAgent, disconnect } from "./socket.js";
import { useStore } from "./store.js";
import { Login } from "./Login.js";
import { ConversationList } from "./ConversationList.js";
import { ConversationPane } from "./ConversationPane.js";
import { AdminAgents } from "./AdminAgents.js";
import { EmbedSnippet } from "./EmbedSnippet.js";
import { AdminMaintenance } from "./AdminMaintenance.js";
import { AdminIdentification } from "./AdminIdentification.js";
import { AdminTags } from "./AdminTags.js";
import { LanguageSwitcher } from "./LanguageSwitcher.js";
import { NotificationsToggle } from "./NotificationsToggle.js";
import { LicenseBanner } from "./LicenseBanner.js";
import {
  ChatBubbleIcon,
  ChevronLeftIcon,
  CodeIcon,
  IdCardIcon,
  InboxIcon,
  LogOutIcon,
  SettingsIcon,
  TagIcon,
  ToolIcon,
  UsersIcon,
} from "./Icons.js";

export function App() {
  const me = useStore((s) => s.me);
  const setMe = useStore((s) => s.setMe);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    (async () => {
      const ok = await api.refresh();
      if (ok) {
        const me = await api.me();
        setMe(me);
        connectAgent();
      }
      setBooted(true);
    })();
    return () => disconnect();
  }, []);

  let inner: React.ReactNode;
  if (!booted) inner = <BootingScreen />;
  else if (!me)
    inner = (
      <Login
        onLoggedIn={(me) => {
          setMe(me);
          connectAgent();
        }}
      />
    );
  else if (view === "admin") inner = <AdminView />;
  else inner = <ChatView />;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <LicenseBanner />
      <div style={{ flex: 1, minHeight: 0 }}>{inner}</div>
    </div>
  );
}

function BootingScreen() {
  const { t } = useTranslation();
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--c-text-muted)",
        fontSize: 13,
      }}
    >
      {t("app.loading")}
    </div>
  );
}

function BrandHeader({ me }: { me: { display_name: string; role: string } }) {
  return (
    <div className="brand">
      <span className="brand-mark">
        <ChatBubbleIcon size={16} />
      </span>
      <div className="brand-text">
        <span className="brand-name">hzaconnect</span>
        <span className="brand-sub">
          {me.display_name} · {me.role}
        </span>
      </div>
    </div>
  );
}

function AdminView() {
  const { t } = useTranslation();
  const me = useStore((s) => s.me)!;
  const setMe = useStore((s) => s.setMe);
  const setView = useStore((s) => s.setView);
  const adminTab = useStore((s) => s.adminTab);
  const setAdminTab = useStore((s) => s.setAdminTab);

  const tabs: Array<{
    key: typeof adminTab;
    label: string;
    icon: React.ReactNode;
  }> = [
    { key: "agents", label: t("admin.tabs.agents"), icon: <UsersIcon size={14} /> },
    { key: "embed", label: t("admin.tabs.embed"), icon: <CodeIcon size={14} /> },
    {
      key: "identification",
      label: t("admin.tabs.identification"),
      icon: <IdCardIcon size={14} />,
    },
    { key: "tags", label: t("admin.tabs.tags"), icon: <TagIcon size={14} /> },
    {
      key: "maintenance",
      label: t("admin.tabs.maintenance"),
      icon: <ToolIcon size={14} />,
    },
  ];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="admin-header">
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          <BrandHeader me={me} />
          <nav style={{ display: "flex", gap: 4 }}>
            {tabs.map((tab) => (
              <button
                key={tab.key}
                className={`toolbar ${adminTab === tab.key ? "primary" : ""}`}
                onClick={() => setAdminTab(tab.key)}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <NotificationsToggle />
          <LanguageSwitcher />
          <button className="toolbar" onClick={() => setView("chat")}>
            <ChevronLeftIcon size={14} />
            {t("header.back_to_chat")}
          </button>
          <button
            className="toolbar"
            onClick={async () => {
              await api.logout();
              authToken.set(null);
              setMe(null);
              disconnect();
            }}
          >
            <LogOutIcon size={14} />
            {t("auth.logout")}
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "hidden" }}>
        {adminTab === "agents" && <AdminAgents />}
        {adminTab === "embed" && <EmbedSnippet />}
        {adminTab === "identification" && <AdminIdentification />}
        {adminTab === "tags" && <AdminTags />}
        {adminTab === "maintenance" && <AdminMaintenance />}
      </div>
    </div>
  );
}

function ChatView() {
  const { t } = useTranslation();
  const me = useStore((s) => s.me)!;
  const setMe = useStore((s) => s.setMe);
  const connected = useStore((s) => s.connected);
  const setView = useStore((s) => s.setView);
  return (
    <div className="layout">
      <div className="sidebar">
        <header>
          <BrandHeader me={me} />
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <NotificationsToggle />
            <LanguageSwitcher />
            {me.role === "admin" && (
              <button
                className="toolbar admin-cta"
                onClick={() => setView("admin")}
                aria-label={t("header.admin")}
              >
                <SettingsIcon size={14} />
                {t("header.admin")}
              </button>
            )}
            <button
              className="icon-btn"
              aria-label={t("auth.logout")}
              title={t("auth.logout")}
              onClick={async () => {
                await api.logout();
                authToken.set(null);
                setMe(null);
                disconnect();
              }}
            >
              <LogOutIcon size={16} />
            </button>
          </div>
        </header>
        {!connected && <div className="banner">{t("queue.reconnecting")}</div>}
        <ConversationList />
      </div>
      <div className="pane">
        <ConversationPane />
      </div>
    </div>
  );
}
