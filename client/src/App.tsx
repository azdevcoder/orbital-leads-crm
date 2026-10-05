import { Toaster } from "@/components/ui/sonner";
import { trpc } from "@/lib/trpc";
import { PLANS, formatPrice, planEconomics, planHasCrm, planHasExport, planHasWhatsapp, type PlanId } from "@shared/plans";
import {
  ArrowUpRight,
  BarChart3,
  Check,
  CheckCircle2,
  Columns3,
  Download,
  FileSpreadsheet,
  Globe2,
  History,
  KeyRound,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  LogOut,
  MapPin,
  Menu,
  MessageCircle,
  Phone,
  Plus,
  Rocket,
  Search as SearchIcon,
  Settings,
  Sheet,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { ArcElement, Chart as ChartJS, DoughnutController, Legend, Tooltip } from "chart.js";
import Sortable from "sortablejs";
import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

ChartJS.register(ArcElement, DoughnutController, Legend, Tooltip);

const PIPELINE_STATUSES = ["Novo", "Contatado", "Em Negociação", "Fechado", "Perdido"] as const;
type PipelineStatus = (typeof PIPELINE_STATUSES)[number];
type ActiveView = "dashboard" | "search" | "crm" | "settings" | "admin";
type CurrentUser = { id: number; name: string | null; email: string | null; phone: string | null; role: "user" | "admin"; plan: PlanId };

const navItems: Array<{ label: string; view: ActiveView; icon: typeof LayoutDashboard }> = [
  { label: "Dashboard", view: "dashboard", icon: LayoutDashboard },
  { label: "Buscar Leads", view: "search", icon: SearchIcon },
  { label: "Meu CRM", view: "crm", icon: Columns3 },
  { label: "Configurações", view: "settings", icon: Settings },
];

const adminNavItem = { label: "Admin", view: "admin" as ActiveView, icon: ShieldCheck };

export function AppNavigation({ view, onNavigate, items = navItems }: { view: ActiveView; onNavigate: (nextView: ActiveView) => void; items?: typeof navItems }) {
  return <nav className="side-nav" aria-label="Navegação principal">
    {items.map(item => {
      const Icon = item.icon;
      return <button key={item.view} className={view === item.view ? "active" : ""} onClick={() => onNavigate(item.view)}><Icon size={18} /><span>{item.label}</span></button>;
    })}
  </nav>;
}

export function ExportActions({ pending, onExport }: { pending: boolean; onExport: (format: "csv" | "xlsx") => void }) {
  return <div className="export-actions"><button className="btn subtle-btn" onClick={() => onExport("csv")} disabled={pending}><Sheet size={16} /> CSV</button><button className="btn cosmic-primary" onClick={() => onExport("xlsx")} disabled={pending}>{pending ? <Loader2 className="spin" size={16} /> : <FileSpreadsheet size={16} />} XLSX</button></div>;
}

export function LeadStatusSelect({ status, onStatusChange }: { status: PipelineStatus; onStatusChange: (status: PipelineStatus) => void }) {
  return <select className="modal-status" value={status} onChange={event => onStatusChange(event.target.value as PipelineStatus)}>{PIPELINE_STATUSES.map(item => <option key={item}>{item}</option>)}</select>;
}

export function NoteComposer({ value, pending, onChange, onAdd }: { value: string; pending: boolean; onChange: (value: string) => void; onAdd: () => void }) {
  return <form className="note-form" onSubmit={event => { event.preventDefault(); if (value.trim()) onAdd(); }}><textarea value={value} onChange={event => onChange(event.target.value)} placeholder="Registe uma observação interna..." /><button className="btn subtle-btn" disabled={pending}><Plus size={15} /> Adicionar nota</button></form>;
}

export function applyKanbanMove(input: { leadId: number; fromStatus?: string; nextStatus?: PipelineStatus; onMove: (leadId: number, status: PipelineStatus) => void }) {
  if (input.leadId && input.nextStatus && input.nextStatus !== input.fromStatus) input.onMove(input.leadId, input.nextStatus);
}

function QuotaBanner({ quota }: { quota: { plan: { name: string }; allowed: boolean; reason: string | null; searchesLeft: number | null; leadsLeft: number | null } }) {
  const parts: string[] = [];
  parts.push(quota.searchesLeft === null ? "buscas ilimitadas" : `${quota.searchesLeft} ${quota.searchesLeft === 1 ? "busca restante" : "buscas restantes"} hoje`);
  if (quota.leadsLeft !== null) parts.push(`${quota.leadsLeft.toLocaleString("pt-BR")} leads restantes hoje`);
  return (
    <div className={`quota-banner panel-glass${quota.allowed ? "" : " quota-exhausted"}`} role="status">
      <span className="plan-chip">{quota.plan.name}</span>
      <span>{quota.allowed ? parts.join(" · ") : quota.reason}</span>
    </div>
  );
}

type AdminUserRow = {
  id: number; openId: string; name: string | null; email: string | null; phone: string | null;
  role: "user" | "admin"; plan: PlanId; quotaDay: string | null;
  dailySearches: number; dailyLeads: number; totalSearches: number;
  createdAt: Date; lastSignedIn: Date;
};

function AdminPanel() {
  const utils = trpc.useUtils();
  const usersQuery = trpc.admin.listUsers.useQuery();
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", plan: "free" as PlanId });
  const setField = (field: "name" | "email" | "phone" | "password" | "plan") => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(current => ({ ...current, [field]: event.target.value }));
  const createUser = trpc.admin.createUser.useMutation({
    onSuccess: async () => {
      setForm({ name: "", email: "", phone: "", password: "", plan: "free" });
      await utils.admin.listUsers.invalidate();
      toast.success("Conta de usuário criada.");
    },
    onError: error => toast.error(error.message),
  });
  const setPlan = trpc.admin.setPlan.useMutation({
    onSuccess: async () => { await utils.admin.listUsers.invalidate(); toast.success("Plano atualizado."); },
    onError: error => toast.error(error.message),
  });
  const [tempPasswords, setTempPasswords] = useState<Record<string, string>>({});
  const resetPassword = trpc.admin.resetPassword.useMutation({
    onSuccess: (data, input) => {
      setTempPasswords(current => ({ ...current, [input.openId]: data.tempPassword }));
      toast.success("Senha temporária gerada. Repasse ao cliente.");
    },
    onError: error => toast.error(error.message),
  });

  return (
    <section className="admin-page">
      <div className="crm-head"><div><p className="eyebrow"><ShieldCheck size={15} /> VISÃO GERAL</p><h1>Painel <em>Admin.</em></h1></div><span className="selection-text">{usersQuery.data?.length ?? 0} contas</span></div>
      <article className="settings-card panel-glass admin-create">
        <div className="panel-heading"><div><p className="eyebrow">NOVO ACESSO</p><h3>Criar conta de usuário</h3></div><Plus size={20} /></div>
        <form onSubmit={event => { event.preventDefault(); createUser.mutate({ ...form }); }} className="admin-form">
          <label>Nome<input value={form.name} onChange={setField("name")} minLength={2} required placeholder="Nome completo" /></label>
          <label>Email<input type="email" value={form.email} onChange={setField("email")} required placeholder="voce@empresa.com" /></label>
          <label>Telefone<input value={form.phone} onChange={setField("phone")} required minLength={8} maxLength={32} placeholder="+55 19 99999-0000" /></label>
          <label>Senha inicial<input type="password" value={form.password} onChange={setField("password")} required minLength={8} placeholder="Mínimo 8 caracteres" /></label>
          <label>Plano<select value={form.plan} onChange={setField("plan")}>{(Object.keys(PLANS) as PlanId[]).map(planId => <option key={planId} value={planId}>{PLANS[planId].name} — {formatPrice(PLANS[planId].price)}</option>)}</select></label>
          <button className="btn cosmic-primary" disabled={createUser.isPending}>{createUser.isPending ? <Loader2 className="spin" size={16} /> : <Plus size={16} />} Criar conta</button>
        </form>
      </article>
      <article className="table-panel panel-glass">
        <div className="panel-heading"><div><p className="eyebrow">CLIENTES</p><h3>Todas as contas</h3></div><Users size={20} /></div>
        <div className="lead-table-wrap">
          {usersQuery.isLoading ? <LoadingLine /> : usersQuery.isError ? <QueryError text="Não foi possível carregar os usuários." onRetry={() => usersQuery.refetch()} /> : (
            <table className="lead-table admin-table">
              <thead><tr><th>Nome</th><th>Contato</th><th>Plano</th><th>Buscas hoje</th><th>Leads hoje</th><th>Total buscas</th><th>Desde</th><th>Acesso</th></tr></thead>
              <tbody>
                {(usersQuery.data as AdminUserRow[] | undefined)?.map(account => (
                  <tr key={account.openId}>
                    <td><strong>{account.name ?? "—"}</strong><br /><small>{account.role === "admin" ? "administrador" : "cliente"}</small></td>
                    <td>{account.email}<br /><small>{account.phone ?? "—"}</small></td>
                    <td>
                      <select aria-label={`Plano de ${account.email}`} value={account.plan} disabled={setPlan.isPending} onChange={event => setPlan.mutate({ openId: account.openId, plan: event.target.value as PlanId })}>
                        {(Object.keys(PLANS) as PlanId[]).map(planId => <option key={planId} value={planId}>{PLANS[planId].name}</option>)}
                      </select>
                    </td>
                    <td>{account.dailySearches}</td>
                    <td>{account.dailyLeads}</td>
                    <td>{account.totalSearches}</td>
                    <td><small>{formatDate(account.createdAt)}</small></td>
                    <td>
                      {tempPasswords[account.openId] ? (
                        <code className="temp-password">{tempPasswords[account.openId]}</code>
                      ) : (
                        <button className="link-btn" disabled={resetPassword.isPending} onClick={() => resetPassword.mutate({ openId: account.openId })} title="Gerar senha temporária">Nova senha</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </article>
    </section>
  );
}

function statusClass(status: string) {
  return `status-${status
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "-")}`;
}

function formatDate(value: Date | string) {
  return new Date(value).toLocaleDateString("pt-PT", { day: "2-digit", month: "short", year: "numeric" });
}

function whatsappLink(phone: string | null) {
  const number = phone?.replace(/\D/g, "") ?? "";
  return number ? `https://wa.me/${number}` : null;
}

function downloadFromBase64(data: { filename: string; mimeType: string; base64: string }) {
  const binary = atob(data.base64);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  const blob = new Blob([bytes], { type: data.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = data.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

const planOrder: PlanId[] = ["free", "start", "plus", "scale"];

function SalesPage({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  const checkout = trpc.cakto.checkout.useMutation({
    onSuccess: data => { window.location.href = data.url; },
    onError: error => toast.error(error.message),
  });
  return (
    <main className="sales-page">
      <div className="cosmic-backdrop" aria-hidden="true"><span className="nebula nebula-one" /><span className="nebula nebula-two" /></div>
      <header className="sales-topbar">
        <div className="brand-lockup"><div className="brand-mark"><Rocket size={19} /></div><span>ORBITAL<span>LEADS</span></span></div>
        <div className="sales-top-actions"><button className="btn subtle-btn" onClick={onLogin}>Entrar</button><button className="btn cosmic-primary" onClick={onRegister}>Criar conta grátis</button></div>
      </header>

      <section className="sales-hero">
        <p className="eyebrow"><Sparkles size={15} /> PROSPECÇÃO B2B EM ÓRBITA</p>
        <h1>Encontre empresas, organize no <em>Kanban</em> e chame no <em>WhatsApp.</em></h1>
        <p>O Orbital Leads captura empresas do Google com telefone, endereço, website e avaliação — e coloca cada oportunidade num pipeline visual com redirecionamento direto para o WhatsApp.</p>
        <div className="sales-cta-row"><button className="btn cosmic-primary" onClick={onRegister}><Rocket size={17} /> Começar grátis</button><button className="btn subtle-btn" onClick={onLogin}>Já tenho conta</button></div>
        <p className="sales-guarantee"><Check size={14} /> Sem cartão de crédito · Cancele quando quiser</p>
      </section>

      <section className="sales-features">
        {[
          { icon: SearchIcon, title: "Captura via Google", text: "Segmento + cidade + UF e o servidor grava nome, telefone, endereço, website e avaliação." },
          { icon: Columns3, title: "CRM Kanban completo", text: "Novo → Contatado → Em negociação → Fechado → Perdido, com arrastar e soltar." },
          { icon: MessageCircle, title: "WhatsApp direto", text: "Cada lead abre conversa no wa.me com um clique, direto da ficha." },
          { icon: FileSpreadsheet, title: "Exportação pronta", text: "Listas filtradas em CSV e XLSX para o seu time comercial." },
        ].map(feature => {
          const Icon = feature.icon;
          return <article key={feature.title} className="panel-glass sales-feature"><span className="metric-icon cyan"><Icon size={20} /></span><div><strong>{feature.title}</strong><p>{feature.text}</p></div></article>;
        })}
      </section>

      <section className="sales-plans" id="planos">
        <p className="eyebrow"><Target size={15} /> PLANOS</p>
        <h2>Escolha a sua <em>órbita.</em></h2>
        <div className="plans-grid">
          {planOrder.map(planId => {
            const plan = PLANS[planId];
            const highlight = planId === "plus";
            return (
              <article key={planId} className={`panel-glass plan-card${highlight ? " plan-highlight" : ""}`}>
                {highlight && <span className="plan-badge">MAIS ESCOLHIDO</span>}
                <p className="eyebrow">{plan.name.toUpperCase()}</p>
                <p className="plan-price">{formatPrice(plan.price)}{plan.price > 0 && <small>/mês</small>}</p>
                <p className="plan-tagline">{plan.tagline}</p>
                {planEconomics(plan) && <p className="plan-econ">{planEconomics(plan)}</p>}
                <ul>{plan.features.map(item => <li key={item}><Check size={14} /> {item}</li>)}</ul>
                <button className={`btn ${highlight ? "cosmic-primary" : "subtle-btn"}`} disabled={checkout.isPending} onClick={() => plan.price === 0 ? onRegister() : checkout.mutate({ plan: planId })}>{checkout.isPending ? <Loader2 className="spin" size={16} /> : plan.price === 0 ? "Criar conta grátis" : `Assinar ${plan.name}`}</button>
              </article>
            );
          })}
        </div>
        <p className="form-hint"><Sparkles size={14} /> Contas e upgrades de plano são ativados pelo time Orbital após a confirmação do pagamento.</p>
      </section>

      <footer className="sales-footer"><span>ORBITAL LEADS · Prospecção B2B em órbita</span><button className="link-btn" onClick={onLogin}>Entrar na plataforma</button></footer>
    </main>
  );
}

function ClaimAccessPage({ token, onAuthenticated }: { token: string; onAuthenticated: (user: CurrentUser) => void }) {
  const [password, setPassword] = useState("");
  const infoQuery = trpc.cakto.claimInfo.useQuery({ token });
  const claim = trpc.auth.claimAccess.useMutation({
    onSuccess: user => {
      window.history.replaceState({}, "", window.location.pathname);
      onAuthenticated(user);
      toast.success("Acesso ativado. Bem-vindo à órbita!");
    },
    onError: error => toast.error(error.message),
  });

  return (
    <main className="auth-shell">
      <div className="auth-orb auth-orb-one" />
      <div className="auth-orb auth-orb-two" />
      <section className="auth-panel">
        <div className="brand-lockup"><div className="brand-mark"><Rocket size={20} /></div><span>ORBITAL<span>LEADS</span></span></div>
        <div className="auth-copy">
          <p className="eyebrow"><CheckCircle2 size={15} /> PAGAMENTO CONFIRMADO</p>
          <h1>Ative o seu <em>acesso.</em></h1>
          <p>A sua compra foi aprovada na Cakto. Defina uma palavra-passe para entrar na plataforma com o email cadastrado na compra.</p>
        </div>
      </section>
      <section className="auth-card-wrap">
        <div className="auth-card">
          {infoQuery.isLoading ? <LoadingLine /> : infoQuery.isError ? (
            <><div className="auth-card-head"><p className="eyebrow">ATIVAÇÃO</p><h2>Link inválido</h2><p>Este link de ativação não existe ou já foi utilizado. Fale com o time Orbital.</p></div></>
          ) : (
            <form onSubmit={event => { event.preventDefault(); claim.mutate({ token, password }); }} className="auth-form">
              <div className="auth-card-head"><p className="eyebrow">ATIVAÇÃO · PLANO {infoQuery.data.plan.name.toUpperCase()}</p><h2>{infoQuery.data.email}</h2></div>
              <label>Nova palavra-passe<input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} placeholder="Mínimo 8 caracteres" /></label>
              <button className="btn btn-primary cosmic-primary w-100" disabled={claim.isPending} type="submit">
                {claim.isPending ? <Loader2 className="spin" size={17} /> : <Rocket size={16} />} Ativar meu acesso
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}

function AuthPage({ onAuthenticated, initialMode = "login", onShowPlans }: { onAuthenticated: (user: CurrentUser) => void; initialMode?: "login" | "register"; onShowPlans?: () => void }) {
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const login = trpc.auth.login.useMutation({ onSuccess: onAuthenticated });
  const register = trpc.auth.register.useMutation({ onSuccess: onAuthenticated });
  const isPending = login.isPending || register.isPending;
  const error = login.error?.message ?? register.error?.message;

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      if (mode === "login") await login.mutateAsync({ email, password });
      else await register.mutateAsync({ name, email, phone, password });
    } catch {
      // A mensagem devolvida pela API é apresentada no formulário.
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-orb auth-orb-one" />
      <div className="auth-orb auth-orb-two" />
      <section className="auth-panel">
        <div className="brand-lockup">
          <div className="brand-mark"><Rocket size={20} /></div>
          <span>ORBITAL<span>LEADS</span></span>
        </div>
        <div className="auth-copy">
          <p className="eyebrow"><Sparkles size={15} /> PROSPECÇÃO B2B EM ÓRBITA</p>
          <h1>Transforme sinais locais em <em>conversas reais.</em></h1>
          <p>Capture empresas, organize oportunidades e acompanhe cada movimento comercial num único centro de comando.</p>
        </div>
        <div className="orbital-illustration" aria-hidden="true">
          <div className="orbit orbit-a" /><div className="orbit orbit-b" />
          <div className="planet-core" /><div className="planet-moon" />
        </div>
      </section>
      <section className="auth-card-wrap">
        <div className="auth-card">
          <div className="auth-card-head">
            <p className="eyebrow">ACESSO SEGURO</p>
            <h2>{mode === "login" ? "Bem-vindo de volta" : "Crie a sua conta"}</h2>
            <p>{mode === "login" ? "Entre para continuar a sua missão comercial." : "Comece a construir a sua máquina de prospeção."}</p>
          </div>
          <div className="auth-toggle" role="tablist" aria-label="Modo de autenticação">
            <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Entrar</button>
            <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Criar conta</button>
          </div>
          <form onSubmit={submit} className="auth-form">
            {mode === "register" && (
              <label>Nome completo<input autoComplete="name" value={name} onChange={e => setName(e.target.value)} minLength={2} required placeholder="Ex.: Sofia Martins" /></label>
            )}
            <label>Email<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="voce@empresa.com" /></label>
            {mode === "register" && (
              <label>Telefone / WhatsApp<input autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} required minLength={8} maxLength={32} placeholder="Ex.: +55 19 99999-0000" /></label>
            )}
            <label>Palavra-passe<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={e => setPassword(e.target.value)} required minLength={mode === "register" ? 8 : 1} placeholder="••••••••" /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="btn btn-primary cosmic-primary w-100" disabled={isPending} type="submit">
              {isPending ? <Loader2 className="spin" size={17} /> : <ArrowUpRight size={17} />}
              {mode === "login" ? "Entrar no centro de comando" : "Lançar a minha conta"}
            </button>
          </form>
          <p className="auth-note"><LockKeyhole size={14} /> Credenciais protegidas por hash bcrypt e sessão JWT.</p>
          {onShowPlans && <p className="auth-note"><button className="link-btn" type="button" onClick={onShowPlans}>← Voltar aos planos</button></p>}
        </div>
      </section>
    </main>
  );
}

function MetricsChart({ values }: { values: Array<{ status: string; count: number }> }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<ChartJS | null>(null);
  const series = PIPELINE_STATUSES.map(status => values.find(value => value.status === status)?.count ?? 0);

  useEffect(() => {
    if (!canvasRef.current) return;
    chartRef.current?.destroy();
    chartRef.current = new ChartJS(canvasRef.current, {
      type: "doughnut",
      data: {
        labels: [...PIPELINE_STATUSES],
        datasets: [{ data: series, backgroundColor: ["#4de9ff", "#a980ff", "#fbbf66", "#73e6b8", "#ff7697"], borderWidth: 0, hoverOffset: 6 }],
      },
      options: {
        cutout: "76%",
        plugins: { legend: { display: false }, tooltip: { backgroundColor: "#171a3c", padding: 12, cornerRadius: 10 } },
      },
    });
    return () => chartRef.current?.destroy();
  }, [series.join(",")]);

  return <canvas ref={canvasRef} aria-label="Distribuição de leads por status" role="img" />;
}

export function AppShell({ user, onLogout, initialView = "dashboard" }: { user: CurrentUser; onLogout: () => void; initialView?: ActiveView }) {
  const [view, setView] = useState<ActiveView>(initialView);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [segment, setSegment] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("SP");
  const [quickSearch, setQuickSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<PipelineStatus | "">("");
  const [segmentFilter, setSegmentFilter] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [activeLeadId, setActiveLeadId] = useState<number | null>(null);
  const [newNote, setNewNote] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editingNoteContent, setEditingNoteContent] = useState("");
  const [contactChannel, setContactChannel] = useState("WhatsApp");
  const [contactDetails, setContactDetails] = useState("");
  const [profileName, setProfileName] = useState(user.name ?? "");
  const [profileEmail, setProfileEmail] = useState(user.email ?? "");
  const [profilePhone, setProfilePhone] = useState(user.phone ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const columnsRef = useRef<Record<PipelineStatus, HTMLDivElement | null>>({
    "Novo": null, "Contatado": null, "Em Negociação": null, "Fechado": null, "Perdido": null,
  });
  const utils = trpc.useUtils();

  const filters = useMemo(() => ({
    status: statusFilter || undefined,
    segment: segmentFilter || undefined,
    city: cityFilter || undefined,
    query: quickSearch || undefined,
  }), [statusFilter, segmentFilter, cityFilter, quickSearch]);
  const leadsQuery = trpc.leads.list.useQuery(filters);
  const metricsQuery = trpc.leads.metrics.useQuery();
  const historyQuery = trpc.places.history.useQuery();
  const quotaQuery = trpc.places.quota.useQuery();
  const detailInput = useMemo(() => ({ leadId: activeLeadId ?? 1 }), [activeLeadId]);
  const detailQuery = trpc.leads.details.useQuery(detailInput, { enabled: activeLeadId !== null });

  const refreshCrm = async () => {
    await Promise.all([utils.leads.list.invalidate(), utils.leads.metrics.invalidate(), utils.places.history.invalidate()]);
  };
  const searchMutation = trpc.places.search.useMutation({
    onSuccess: async result => { toast.success(`${result.saved} leads sincronizados a partir do Google Places.`); await refreshCrm(); setView("crm"); },
    onError: error => toast.error(error.message),
  });
  const rerunMutation = trpc.places.rerun.useMutation({
    onSuccess: async result => { toast.success(`Busca repetida: ${result.saved} leads sincronizados.`); await refreshCrm(); },
    onError: error => toast.error(error.message),
  });
  const statusMutation = trpc.leads.updateStatus.useMutation({
    onMutate: async input => {
      // Move otimista: o React redesenha o card na coluna nova de imediato.
      await utils.leads.list.cancel().catch(() => undefined);
      const previous = utils.leads.list.getData(filters);
      utils.leads.list.setData(filters, old => old?.map(lead => lead.id === input.leadId ? { ...lead, status: input.status } : lead));
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) utils.leads.list.setData(filters, context.previous);
      toast.error(error.message);
    },
    onSuccess: async () => { await utils.leads.list.invalidate(); await utils.leads.metrics.invalidate(); await utils.leads.details.invalidate(); },
  });
  const noteMutation = trpc.leads.addNote.useMutation({
    onSuccess: async () => { setNewNote(""); await utils.leads.details.invalidate(); toast.success("Nota adicionada ao lead."); },
    onError: error => toast.error(error.message),
  });
  const updateNoteMutation = trpc.leads.updateNote.useMutation({
    onSuccess: async () => { setEditingNoteId(null); setEditingNoteContent(""); await utils.leads.details.invalidate(); toast.success("Nota atualizada."); },
    onError: error => toast.error(error.message),
  });
  const contactMutation = trpc.leads.addContact.useMutation({
    onSuccess: async () => { setContactDetails(""); await utils.leads.details.invalidate(); toast.success("Contacto registado."); },
    onError: error => toast.error(error.message),
  });
  const exportMutation = trpc.leads.export.useMutation({
    onSuccess: data => { downloadFromBase64(data); toast.success("Exportação preparada para download."); },
    onError: error => toast.error(error.message),
  });
  const profileMutation = trpc.auth.updateProfile.useMutation({
    onSuccess: async () => { toast.success("Perfil atualizado."); await utils.auth.me.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const passwordMutation = trpc.auth.changePassword.useMutation({
    onSuccess: () => { setCurrentPassword(""); setNewPassword(""); toast.success("Palavra-passe atualizada."); },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    if (view !== "crm") return;
    const instances = PIPELINE_STATUSES.map(status => {
      const element = columnsRef.current[status];
      if (!element) return null;
      return Sortable.create(element, {
        group: "orbital-pipeline",
        animation: 180,
        ghostClass: "lead-ghost",
        dragClass: "lead-dragging",
        onEnd: event => {
          const item = event.item as HTMLElement | undefined;
          const from = event.from as unknown as HTMLElement | undefined;
          const to = event.to as unknown as HTMLElement | undefined;
          // Reverte a mutação do SortableJS: o React é o dono do DOM e
          // redesenha as colunas a partir do estado (otimista + servidor).
          // Sem isto, o React tenta remover um nó que já mudou de pai e a
          // árvore inteira desmonta (ecrã em branco após arrastar).
          try {
            if (item && from && typeof event.oldIndex === "number") {
              const ref = from.children[event.oldIndex] ?? null;
              item.parentNode?.removeChild(item);
              from.insertBefore(item, ref);
            }
          } catch {
            // DOM incompleto (ex.: mocks); o próximo render corrige.
          }
          const leadId = Number(item?.dataset.leadId);
          const nextStatus = to?.dataset.status as PipelineStatus | undefined;
          applyKanbanMove({ leadId, fromStatus: from?.dataset.status, nextStatus, onMove: (id, status) => statusMutation.mutate({ leadId: id, status }) });
        },
      });
    });
    return () => instances.forEach(instance => instance?.destroy());
  }, [view, leadsQuery.data, statusMutation.mutate]);

  const leadGroups = useMemo(() => {
    const groups: Record<PipelineStatus, NonNullable<typeof leadsQuery.data>> = {
      "Novo": [],
      "Contatado": [],
      "Em Negociação": [],
      "Fechado": [],
      "Perdido": [],
    };
    leadsQuery.data?.forEach(lead => groups[lead.status].push(lead));
    return groups;
  }, [leadsQuery.data]);

  const isAdmin = user.role === "admin";
  const visibleNav = isAdmin ? [...navItems, adminNavItem] : navItems;
  const activeLabel = [...navItems, adminNavItem].find(item => item.view === view)?.label ?? "Dashboard";
  const dashboardMetrics = metricsQuery.data ?? { total: 0, byStatus: [] };

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    searchMutation.mutate({ segment, city, state });
  }

  function handleExport(format: "csv" | "xlsx") {
    exportMutation.mutate({ format, filters: { ...filters, selectedIds: selectedIds.length ? selectedIds : undefined } });
  }

  function toggleSelection(leadId: number) {
    setSelectedIds(current => current.includes(leadId) ? current.filter(id => id !== leadId) : [...current, leadId]);
  }

  return (
    <main className="app-shell">
      <div className="cosmic-backdrop" aria-hidden="true"><span className="nebula nebula-one" /><span className="nebula nebula-two" /><span className="lens-flare" /></div>
      <aside className={`side-rail ${mobileNavOpen ? "open" : ""}`}>
        <div className="brand-lockup"><div className="brand-mark"><Rocket size={19} /></div><span>ORBITAL<span>LEADS</span></span></div>
        <div className="side-caption">CENTRO DE COMANDO</div>
        <AppNavigation view={view} onNavigate={nextView => { setView(nextView); setMobileNavOpen(false); }} items={visibleNav} />
        <div className="side-footer">
          <div className="user-mini"><span className="avatar-orb">{(user.name ?? user.email ?? "U").slice(0, 1).toUpperCase()}</span><span><strong>{user.name ?? "Utilizador"}</strong><small>{user.email}</small></span></div>
          <button className="logout-button" onClick={onLogout}><LogOut size={17} /> Terminar sessão</button>
        </div>
      </aside>
      {mobileNavOpen && <button className="mobile-overlay" onClick={() => setMobileNavOpen(false)} aria-label="Fechar menu" />}
      <section className="main-stage">
        <header className="topbar">
          <div className="topbar-title"><button className="mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Abrir navegação"><Menu size={20} /></button><div><p className="eyebrow">ORBITAL / {activeLabel.toUpperCase()}</p><h2>{activeLabel}</h2></div></div>
          <div className="topbar-actions"><span className="sync-chip"><span className="pulse-dot" /> sistema ativo</span><button className="user-orb" onClick={() => setView("settings")} aria-label="Abrir configurações">{(user.name ?? user.email ?? "U").slice(0, 1).toUpperCase()}</button></div>
        </header>

        {view === "dashboard" && (
          <section className="page-grid dashboard-page">
            <div className="hero-command panel-glass"><div><p className="eyebrow"><Sparkles size={15} /> RADAR COMERCIAL</p><h1>Olá, {user.name?.split(" ")[0] ?? "explorador"}.</h1><p>O seu universo comercial está pronto para a próxima coordenada.</p><button className="btn cosmic-primary" onClick={() => setView("search")}><SearchIcon size={17} /> Iniciar uma busca</button></div><div className="hero-radar"><div className="radar-ring ring-one" /><div className="radar-ring ring-two" /><div className="radar-ring ring-three" /><span className="radar-sweep" /><span className="radar-core" /></div></div>
            {metricsQuery.isError ? <QueryError text="Não foi possível carregar as métricas do seu tenant." onRetry={() => metricsQuery.refetch()} /> : <><div className="metrics-row">
              <article className="metric-card panel-glass"><span className="metric-icon cyan"><Users size={20} /></span><div><small>LEADS CAPTURADOS</small><strong>{dashboardMetrics.total}</strong><span>Total no seu tenant</span></div></article>
              <article className="metric-card panel-glass"><span className="metric-icon violet"><Target size={20} /></span><div><small>EM NEGOCIAÇÃO</small><strong>{dashboardMetrics.byStatus.find(item => item.status === "Em Negociação")?.count ?? 0}</strong><span>Oportunidades ativas</span></div></article>
              <article className="metric-card panel-glass"><span className="metric-icon green"><CheckCircle2 size={20} /></span><div><small>FECHADOS</small><strong>{dashboardMetrics.byStatus.find(item => item.status === "Fechado")?.count ?? 0}</strong><span>Resultados conquistados</span></div></article>
            </div>
            <article className="chart-panel panel-glass"><div className="panel-heading"><div><p className="eyebrow">DISTRIBUIÇÃO</p><h3>Pipeline em órbita</h3></div><BarChart3 size={20} /></div><div className="chart-content"><div className="chart-wrap"><MetricsChart values={dashboardMetrics.byStatus} /><div className="chart-center"><strong>{dashboardMetrics.total}</strong><span>LEADS</span></div></div><div className="status-legend">{PIPELINE_STATUSES.map((status, index) => <div key={status}><span className={`legend-dot dot-${index}`} /><span>{status}</span><strong>{dashboardMetrics.byStatus.find(item => item.status === status)?.count ?? 0}</strong></div>)}</div></div></article></>}
            <article className="quick-search panel-glass"><div className="panel-heading"><div><p className="eyebrow">ATALHO</p><h3>Nova exploração</h3></div><SearchIcon size={20} /></div><form onSubmit={handleSearch} className="quick-search-form"><input value={segment} onChange={e => setSegment(e.target.value)} placeholder="Segmento ou nicho" required /><input value={city} onChange={e => setCity(e.target.value)} placeholder="Cidade" required /><input value={state} onChange={e => setState(e.target.value.toUpperCase())} maxLength={8} placeholder="UF" required /><button className="btn cosmic-primary" disabled={searchMutation.isPending}>{searchMutation.isPending ? <Loader2 className="spin" size={16} /> : <Rocket size={16} />} Buscar</button></form></article>
          </section>
        )}

        {view === "search" && (
          <section className="search-page">
            <div className="search-hero"><p className="eyebrow"><MapPin size={15} /> GOOGLE PLACES</p><h1>Defina a sua próxima <em>coordenada.</em></h1><p>Pesquise empresas por segmento e localização. Os campos <strong>Nome, Telefone, Endereço completo, Website, Avaliação e Status</strong> são gravados automaticamente no seu CRM.</p></div>
            {quotaQuery.data && <QuotaBanner quota={quotaQuery.data} />}
            <article className="search-console panel-glass"><form onSubmit={handleSearch}><div className="search-fields"><label>Segmento / Nicho<input value={segment} onChange={e => setSegment(e.target.value)} placeholder="Ex.: Pizzarias" required /></label><label>Cidade<input value={city} onChange={e => setCity(e.target.value)} placeholder="Ex.: Lisboa" required /></label><label>Estado (UF)<input value={state} onChange={e => setState(e.target.value.toUpperCase())} maxLength={8} placeholder="Ex.: SP" required /></label></div><button className="btn cosmic-primary search-submit" disabled={searchMutation.isPending}>{searchMutation.isPending ? <><Loader2 className="spin" size={17} /> A consultar a galáxia...</> : <><SearchIcon size={17} /> Capturar leads</>}</button></form><p className="form-hint"><Sparkles size={14} /> A captura usa o Google Places no servidor e associa todos os resultados apenas ao seu tenant.</p></article>
            <article className="history-panel panel-glass"><div className="panel-heading"><div><p className="eyebrow">MEMÓRIA DE VOO</p><h3>Histórico de buscas</h3></div><History size={20} /></div>{historyQuery.isLoading ? <LoadingLine /> : historyQuery.isError ? <QueryError text="Não foi possível carregar o histórico de buscas." onRetry={() => historyQuery.refetch()} /> : historyQuery.data?.length ? <div className="history-list">{historyQuery.data.map(item => <div className="history-item" key={item.id}><span className="history-orb"><SearchIcon size={15} /></span><div><strong>{item.segment}</strong><p>{item.city}, {item.state} <span>·</span> {item.resultCount} leads</p></div><span className="history-date">{formatDate(item.createdAt)}</span><button className="icon-action" onClick={() => rerunMutation.mutate({ searchId: item.id })} disabled={rerunMutation.isPending} title="Repetir busca"><Rocket size={16} /></button></div>)}</div> : <EmptyState icon={<History size={28} />} text="As suas pesquisas recentes vão aparecer aqui." />}</article>
          </section>
        )}

        {view === "crm" && (
          <section className="crm-page">
            <div className="crm-head"><div><p className="eyebrow">OPERAÇÕES COMERCIAIS</p><h1>Meu <em>CRM.</em></h1></div>{planHasExport(user.plan) && <ExportActions pending={exportMutation.isPending} onExport={handleExport} />}</div>
            <article className="filter-bar panel-glass"><div className="input-icon"><SearchIcon size={16} /><input value={quickSearch} onChange={e => setQuickSearch(e.target.value)} placeholder="Busca rápida por nome, telefone, endereço ou website" /></div><select value={statusFilter} onChange={e => setStatusFilter(e.target.value as PipelineStatus | "")}><option value="">Todos os status</option>{PIPELINE_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}</select><input value={segmentFilter} onChange={e => setSegmentFilter(e.target.value)} placeholder="Segmento" /><input value={cityFilter} onChange={e => setCityFilter(e.target.value)} placeholder="Cidade" /><button className="clear-filters" onClick={() => { setQuickSearch(""); setStatusFilter(""); setSegmentFilter(""); setCityFilter(""); }}>Limpar</button></article>
            <div className="crm-sections"><article className="table-panel panel-glass"><div className="panel-heading"><div><p className="eyebrow">LISTA</p><h3>Leads capturados <span>{leadsQuery.data?.length ?? 0}</span></h3></div><span className="selection-text">{selectedIds.length ? `${selectedIds.length} selecionado${selectedIds.length > 1 ? "s" : ""}` : "Selecione para exportar"}</span></div><div className="lead-table-wrap"><table className="lead-table"><thead><tr><th /><th>Nome</th><th>Segmento</th><th>Localização</th><th>Avaliação</th><th>Status</th><th /></tr></thead><tbody>{leadsQuery.isLoading ? <tr><td colSpan={7}><LoadingLine /></td></tr> : leadsQuery.isError ? <tr><td colSpan={7}><QueryError text="Não foi possível carregar os leads." onRetry={() => leadsQuery.refetch()} /></td></tr> : leadsQuery.data?.length ? leadsQuery.data.map(lead => <tr key={lead.id}><td><input aria-label={`Selecionar ${lead.name}`} type="checkbox" checked={selectedIds.includes(lead.id)} onChange={() => toggleSelection(lead.id)} /></td><td><button className="lead-name" onClick={() => setActiveLeadId(lead.id)}>{lead.name}<small>{lead.phone ?? "Sem telefone"}</small></button></td><td><span className="segment-chip">{lead.segment}</span></td><td>{lead.city}, {lead.state}</td><td>{lead.rating ? <span className="rating"><Star size={14} fill="currentColor" /> {lead.rating}</span> : "—"}</td><td><span className={`status-pill ${statusClass(lead.status)}`}>{lead.status}</span></td><td><button className="icon-action" onClick={() => setActiveLeadId(lead.id)} title="Abrir detalhes"><ArrowUpRight size={16} /></button></td></tr>) : <tr><td colSpan={7}><EmptyState icon={<Users size={27} />} text="Ainda não há leads para estes filtros." /></td></tr>}</tbody></table></div></article>
              {planHasCrm(user.plan) ? <article className="kanban-wrap"><div className="panel-heading"><div><p className="eyebrow">PIPELINE DE VENDAS</p><h3>Arraste para mover cada oportunidade</h3></div><Columns3 size={20} /></div>{leadsQuery.isError ? <QueryError text="O pipeline não está disponível neste momento." onRetry={() => leadsQuery.refetch()} /> : <div className="kanban-board">{PIPELINE_STATUSES.map(status => <section className="kanban-column" key={status}><header><span className={`status-dot ${statusClass(status)}`} /><strong>{status}</strong><span>{leadGroups[status]?.length ?? 0}</span></header><div className="kanban-dropzone" data-status={status} ref={element => { columnsRef.current[status] = element; }}>{leadGroups[status]?.map(lead => <article className="lead-card" data-lead-id={lead.id} key={lead.id} onClick={() => setActiveLeadId(lead.id)}><div className="lead-card-top"><span className="grab-hint">···</span><span className="rating">{lead.rating ? <><Star size={12} fill="currentColor" /> {lead.rating}</> : "Novo"}</span></div><h4>{lead.name}</h4><p><MapPin size={13} /> {lead.city}, {lead.state}</p><div className="lead-card-footer"><span>{lead.segment}</span>{planHasWhatsapp(user.plan) && whatsappLink(lead.phone) ? <a href={whatsappLink(lead.phone)!} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()} title="Abrir WhatsApp"><MessageCircle size={16} /></a> : <span className="no-phone"><Phone size={14} /></span>}</div></article>)}</div></section>)}</div>}</article> : <article className="kanban-wrap"><div className="upgrade-note panel-glass"><p className="eyebrow">PIPELINE BLOQUEADO</p><p>O Kanban com arrastar e soltar está disponível a partir do plano Plus. Fale com o time Orbital para ativar.</p></div></article>}
            </div>
          </section>
        )}

        {view === "settings" && (
          <section className="settings-page"><div className="settings-hero"><p className="eyebrow"><Settings size={15} /> IDENTIDADE DO UTILIZADOR</p><h1>Configurações de <em>conta.</em></h1><p>Atualize os seus dados e mantenha as credenciais protegidas.</p></div><div className="settings-grid"><article className="settings-card panel-glass"><div className="panel-heading"><div><p className="eyebrow">PERFIL</p><h3>Dados pessoais</h3></div><UserRound size={20} /></div><form onSubmit={event => { event.preventDefault(); profileMutation.mutate({ name: profileName, email: profileEmail, phone: profilePhone || undefined }); }}><label>Nome<input value={profileName} onChange={e => setProfileName(e.target.value)} minLength={2} required /></label><label>Email<input type="email" value={profileEmail} onChange={e => setProfileEmail(e.target.value)} required /></label><label>Telefone<input value={profilePhone} onChange={e => setProfilePhone(e.target.value)} minLength={8} maxLength={32} placeholder="+55 19 99999-0000" /></label><p className="form-hint">Plano atual: <strong>{PLANS[user.plan]?.name ?? user.plan}</strong></p><button className="btn cosmic-primary" disabled={profileMutation.isPending}>{profileMutation.isPending ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />} Guardar perfil</button></form></article><article className="settings-card panel-glass"><div className="panel-heading"><div><p className="eyebrow">SEGURANÇA</p><h3>Alterar palavra-passe</h3></div><KeyRound size={20} /></div><form onSubmit={event => { event.preventDefault(); passwordMutation.mutate({ currentPassword, newPassword }); }}><label>Palavra-passe atual<input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required /></label><label>Nova palavra-passe<input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={8} required /></label><button className="btn cosmic-primary" disabled={passwordMutation.isPending}>{passwordMutation.isPending ? <Loader2 className="spin" size={16} /> : <LockKeyhole size={16} />} Atualizar palavra-passe</button></form></article></div></section>
        )}

        {view === "admin" && (
          isAdmin ? <AdminPanel /> : <section className="settings-page"><QueryError text="Área restrita ao administrador." onRetry={() => setView("dashboard")} /></section>
        )}
      </section>

      {activeLeadId !== null && <div className="modal-backdrop" role="presentation" onMouseDown={() => setActiveLeadId(null)}><section className="lead-modal panel-glass" role="dialog" aria-modal="true" aria-label="Detalhes do lead" onMouseDown={event => event.stopPropagation()}><button className="modal-close" onClick={() => setActiveLeadId(null)} aria-label="Fechar detalhes"><X size={19} /></button>{detailQuery.isLoading ? <LoadingLine /> : detailQuery.isError ? <QueryError text="Não foi possível carregar os detalhes deste lead." onRetry={() => detailQuery.refetch()} /> : detailQuery.data ? <><div className="modal-lead-head"><div><p className="eyebrow">FICHA DO LEAD</p><h2>{detailQuery.data.lead.name}</h2><p><MapPin size={14} /> {detailQuery.data.lead.fullAddress ?? `${detailQuery.data.lead.city}, ${detailQuery.data.lead.state}`}</p></div>{planHasCrm(user.plan) ? <LeadStatusSelect status={detailQuery.data.lead.status} onStatusChange={status => statusMutation.mutate({ leadId: activeLeadId, status })} /> : <span className={`status-pill ${statusClass(detailQuery.data.lead.status)}`}>{detailQuery.data.lead.status}</span>}</div><div className="contact-links"><span><Phone size={16} /> {detailQuery.data.lead.phone ?? "Telefone indisponível"}</span>{detailQuery.data.lead.website && <a href={detailQuery.data.lead.website} target="_blank" rel="noreferrer"><Globe2 size={16} /> Website</a>}{planHasWhatsapp(user.plan) && whatsappLink(detailQuery.data.lead.phone) && <a className="whatsapp-link" href={whatsappLink(detailQuery.data.lead.phone)!} target="_blank" rel="noreferrer"><MessageCircle size={16} /> WhatsApp</a>}</div><div className="modal-grid"><div><h4>Notas internas</h4><NoteComposer value={newNote} pending={noteMutation.isPending} onChange={setNewNote} onAdd={() => noteMutation.mutate({ leadId: activeLeadId, content: newNote })} /><div className="note-list">{detailQuery.data.notes.length ? detailQuery.data.notes.map(note => <article key={note.id}>{editingNoteId === note.id ? <form className="note-form" onSubmit={event => { event.preventDefault(); if (editingNoteContent.trim()) updateNoteMutation.mutate({ noteId: note.id, content: editingNoteContent }); }}><textarea value={editingNoteContent} onChange={e => setEditingNoteContent(e.target.value)} aria-label="Editar nota" /><div><button className="btn subtle-btn" disabled={updateNoteMutation.isPending}>Guardar</button><button type="button" className="note-cancel" onClick={() => { setEditingNoteId(null); setEditingNoteContent(""); }}>Cancelar</button></div></form> : <><p>{note.content}</p><div className="note-meta"><small>{formatDate(note.updatedAt)}</small><button className="note-edit" onClick={() => { setEditingNoteId(note.id); setEditingNoteContent(note.content); }}>Editar</button></div></>}</article>) : <p className="empty-copy">Ainda não existem notas internas.</p>}</div></div><div><h4>Histórico de contactos</h4><form className="contact-form" onSubmit={event => { event.preventDefault(); contactMutation.mutate({ leadId: activeLeadId, channel: contactChannel, details: contactDetails || undefined }); }}><select value={contactChannel} onChange={e => setContactChannel(e.target.value)}><option>WhatsApp</option><option>Telefone</option><option>Email</option><option>Reunião</option><option>Outro</option></select><input value={contactDetails} onChange={e => setContactDetails(e.target.value)} placeholder="Detalhe opcional" /><button className="btn subtle-btn" disabled={contactMutation.isPending}><Plus size={15} /> Registar contacto</button></form><div className="contact-log">{detailQuery.data.contacts.length ? detailQuery.data.contacts.map(contact => <article key={contact.id}><span className="contact-icon"><MessageCircle size={14} /></span><div><strong>{contact.channel}</strong><p>{contact.details || "Contacto registado"}</p><small>{formatDate(contact.contactedAt)}</small></div></article>) : <p className="empty-copy">Nenhum contacto registado.</p>}</div></div></div></> : <EmptyState icon={<Users size={28} />} text="Lead não encontrado." />}</section></div>}
    </main>
  );
}

function QueryError({ text, onRetry }: { text: string; onRetry: () => void }) {
  return <div className="query-error"><p>{text}</p><button className="btn subtle-btn" onClick={onRetry}>Tentar novamente</button></div>;
}

function LoadingLine() {
  return <div className="loading-line"><span /></div>;
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return <div className="empty-state"><span>{icon}</span><p>{text}</p></div>;
}

function App() {
  const utils = trpc.useUtils();
  const meQuery = trpc.auth.me.useQuery();
  const [authScreen, setAuthScreen] = useState<"plans" | "login" | "register">("plans");
  const logout = trpc.auth.logout.useMutation({
    onSuccess: async () => { utils.auth.me.setData(undefined, null); await utils.auth.me.invalidate(); },
  });

  if (meQuery.isLoading) return <div className="initial-loader"><Rocket size={28} /><span>Preparar centro de comando...</span></div>;
  const requestedPreview = import.meta.env.DEV ? new URLSearchParams(window.location.search).get("preview") : null;
  const previewView = navItems.some(item => item.view === requestedPreview) ? requestedPreview as ActiveView : null;
  const previewUser: CurrentUser = { id: 0, name: "Pré-visualização", email: "preview@local.dev", phone: null, role: "user", plan: "scale" };
  const authenticate = (user: CurrentUser) => { utils.auth.me.setData(undefined, user); };
  const activateToken = new URLSearchParams(window.location.search).get("ativar");
  return <><Toaster richColors position="top-right" theme="dark" />{meQuery.data ? <AppShell user={meQuery.data} onLogout={() => logout.mutate()} /> : previewView ? <AppShell user={previewUser} initialView={previewView} onLogout={() => { window.location.href = "/"; }} /> : activateToken ? <ClaimAccessPage token={activateToken} onAuthenticated={authenticate} /> : authScreen === "plans" ? <SalesPage onLogin={() => setAuthScreen("login")} onRegister={() => setAuthScreen("register")} /> : <AuthPage initialMode={authScreen} onShowPlans={() => setAuthScreen("plans")} onAuthenticated={authenticate} />}</>;
}

export default App;
