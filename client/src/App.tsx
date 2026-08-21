import { Toaster } from "@/components/ui/sonner";
import { trpc } from "@/lib/trpc";
import {
  ArrowUpRight,
  BarChart3,
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
  Sparkles,
  Star,
  Target,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { ArcElement, Chart as ChartJS, DoughnutController, Legend, Tooltip } from "chart.js";
import Sortable from "sortablejs";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

ChartJS.register(ArcElement, DoughnutController, Legend, Tooltip);

const PIPELINE_STATUSES = ["Novo", "Contatado", "Em Negociação", "Fechado", "Perdido"] as const;
type PipelineStatus = (typeof PIPELINE_STATUSES)[number];
type ActiveView = "dashboard" | "search" | "crm" | "settings";
type CurrentUser = { id: number; name: string | null; email: string | null; role: "user" | "admin" };

const navItems: Array<{ label: string; view: ActiveView; icon: typeof LayoutDashboard }> = [
  { label: "Dashboard", view: "dashboard", icon: LayoutDashboard },
  { label: "Buscar Leads", view: "search", icon: SearchIcon },
  { label: "Meu CRM", view: "crm", icon: Columns3 },
  { label: "Configurações", view: "settings", icon: Settings },
];

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

function AuthPage({ onAuthenticated }: { onAuthenticated: (user: CurrentUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = trpc.auth.login.useMutation({ onSuccess: onAuthenticated });
  const register = trpc.auth.register.useMutation({ onSuccess: onAuthenticated });
  const isPending = login.isPending || register.isPending;
  const error = login.error?.message ?? register.error?.message;

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      if (mode === "login") await login.mutateAsync({ email, password });
      else await register.mutateAsync({ name, email, password });
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
            <label>Palavra-passe<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={e => setPassword(e.target.value)} required minLength={mode === "register" ? 8 : 1} placeholder="••••••••" /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="btn btn-primary cosmic-primary w-100" disabled={isPending} type="submit">
              {isPending ? <Loader2 className="spin" size={17} /> : <ArrowUpRight size={17} />}
              {mode === "login" ? "Entrar no centro de comando" : "Lançar a minha conta"}
            </button>
          </form>
          <p className="auth-note"><LockKeyhole size={14} /> Credenciais protegidas por hash bcrypt e sessão JWT.</p>
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

function AppShell({ user, onLogout }: { user: CurrentUser; onLogout: () => void }) {
  const [view, setView] = useState<ActiveView>("dashboard");
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
    onSuccess: async () => { await utils.leads.list.invalidate(); await utils.leads.metrics.invalidate(); await utils.leads.details.invalidate(); },
    onError: error => toast.error(error.message),
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
          const leadId = Number((event.item as HTMLElement).dataset.leadId);
          const nextStatus = event.to.dataset.status as PipelineStatus | undefined;
          if (leadId && nextStatus && nextStatus !== event.from.dataset.status) {
            statusMutation.mutate({ leadId, status: nextStatus });
          }
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

  const activeLabel = navItems.find(item => item.view === view)?.label ?? "Dashboard";
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
        <nav className="side-nav" aria-label="Navegação principal">
          {navItems.map(item => {
            const Icon = item.icon;
            return <button key={item.view} className={view === item.view ? "active" : ""} onClick={() => { setView(item.view); setMobileNavOpen(false); }}><Icon size={18} /><span>{item.label}</span></button>;
          })}
        </nav>
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
            <article className="search-console panel-glass"><form onSubmit={handleSearch}><div className="search-fields"><label>Segmento / Nicho<input value={segment} onChange={e => setSegment(e.target.value)} placeholder="Ex.: Pizzarias" required /></label><label>Cidade<input value={city} onChange={e => setCity(e.target.value)} placeholder="Ex.: Lisboa" required /></label><label>Estado (UF)<input value={state} onChange={e => setState(e.target.value.toUpperCase())} maxLength={8} placeholder="Ex.: SP" required /></label></div><button className="btn cosmic-primary search-submit" disabled={searchMutation.isPending}>{searchMutation.isPending ? <><Loader2 className="spin" size={17} /> A consultar a galáxia...</> : <><SearchIcon size={17} /> Capturar leads</>}</button></form><p className="form-hint"><Sparkles size={14} /> A captura usa o Google Places no servidor e associa todos os resultados apenas ao seu tenant.</p></article>
            <article className="history-panel panel-glass"><div className="panel-heading"><div><p className="eyebrow">MEMÓRIA DE VOO</p><h3>Histórico de buscas</h3></div><History size={20} /></div>{historyQuery.isLoading ? <LoadingLine /> : historyQuery.isError ? <QueryError text="Não foi possível carregar o histórico de buscas." onRetry={() => historyQuery.refetch()} /> : historyQuery.data?.length ? <div className="history-list">{historyQuery.data.map(item => <div className="history-item" key={item.id}><span className="history-orb"><SearchIcon size={15} /></span><div><strong>{item.segment}</strong><p>{item.city}, {item.state} <span>·</span> {item.resultCount} leads</p></div><span className="history-date">{formatDate(item.createdAt)}</span><button className="icon-action" onClick={() => rerunMutation.mutate({ searchId: item.id })} disabled={rerunMutation.isPending} title="Repetir busca"><Rocket size={16} /></button></div>)}</div> : <EmptyState icon={<History size={28} />} text="As suas pesquisas recentes vão aparecer aqui." />}</article>
          </section>
        )}

        {view === "crm" && (
          <section className="crm-page">
            <div className="crm-head"><div><p className="eyebrow">OPERAÇÕES COMERCIAIS</p><h1>Meu <em>CRM.</em></h1></div><div className="export-actions"><button className="btn subtle-btn" onClick={() => handleExport("csv")} disabled={exportMutation.isPending}><Sheet size={16} /> CSV</button><button className="btn cosmic-primary" onClick={() => handleExport("xlsx")} disabled={exportMutation.isPending}>{exportMutation.isPending ? <Loader2 className="spin" size={16} /> : <FileSpreadsheet size={16} />} XLSX</button></div></div>
            <article className="filter-bar panel-glass"><div className="input-icon"><SearchIcon size={16} /><input value={quickSearch} onChange={e => setQuickSearch(e.target.value)} placeholder="Busca rápida por nome, telefone, endereço ou website" /></div><select value={statusFilter} onChange={e => setStatusFilter(e.target.value as PipelineStatus | "")}><option value="">Todos os status</option>{PIPELINE_STATUSES.map(status => <option key={status} value={status}>{status}</option>)}</select><input value={segmentFilter} onChange={e => setSegmentFilter(e.target.value)} placeholder="Segmento" /><input value={cityFilter} onChange={e => setCityFilter(e.target.value)} placeholder="Cidade" /><button className="clear-filters" onClick={() => { setQuickSearch(""); setStatusFilter(""); setSegmentFilter(""); setCityFilter(""); }}>Limpar</button></article>
            <div className="crm-sections"><article className="table-panel panel-glass"><div className="panel-heading"><div><p className="eyebrow">LISTA</p><h3>Leads capturados <span>{leadsQuery.data?.length ?? 0}</span></h3></div><span className="selection-text">{selectedIds.length ? `${selectedIds.length} selecionado${selectedIds.length > 1 ? "s" : ""}` : "Selecione para exportar"}</span></div><div className="lead-table-wrap"><table className="lead-table"><thead><tr><th /><th>Nome</th><th>Segmento</th><th>Localização</th><th>Avaliação</th><th>Status</th><th /></tr></thead><tbody>{leadsQuery.isLoading ? <tr><td colSpan={7}><LoadingLine /></td></tr> : leadsQuery.isError ? <tr><td colSpan={7}><QueryError text="Não foi possível carregar os leads." onRetry={() => leadsQuery.refetch()} /></td></tr> : leadsQuery.data?.length ? leadsQuery.data.map(lead => <tr key={lead.id}><td><input aria-label={`Selecionar ${lead.name}`} type="checkbox" checked={selectedIds.includes(lead.id)} onChange={() => toggleSelection(lead.id)} /></td><td><button className="lead-name" onClick={() => setActiveLeadId(lead.id)}>{lead.name}<small>{lead.phone ?? "Sem telefone"}</small></button></td><td><span className="segment-chip">{lead.segment}</span></td><td>{lead.city}, {lead.state}</td><td>{lead.rating ? <span className="rating"><Star size={14} fill="currentColor" /> {lead.rating}</span> : "—"}</td><td><span className={`status-pill ${statusClass(lead.status)}`}>{lead.status}</span></td><td><button className="icon-action" onClick={() => setActiveLeadId(lead.id)} title="Abrir detalhes"><ArrowUpRight size={16} /></button></td></tr>) : <tr><td colSpan={7}><EmptyState icon={<Users size={27} />} text="Ainda não há leads para estes filtros." /></td></tr>}</tbody></table></div></article>
              <article className="kanban-wrap"><div className="panel-heading"><div><p className="eyebrow">PIPELINE DE VENDAS</p><h3>Arraste para mover cada oportunidade</h3></div><Columns3 size={20} /></div>{leadsQuery.isError ? <QueryError text="O pipeline não está disponível neste momento." onRetry={() => leadsQuery.refetch()} /> : <div className="kanban-board">{PIPELINE_STATUSES.map(status => <section className="kanban-column" key={status}><header><span className={`status-dot ${statusClass(status)}`} /><strong>{status}</strong><span>{leadGroups[status]?.length ?? 0}</span></header><div className="kanban-dropzone" data-status={status} ref={element => { columnsRef.current[status] = element; }}>{leadGroups[status]?.map(lead => <article className="lead-card" data-lead-id={lead.id} key={lead.id} onClick={() => setActiveLeadId(lead.id)}><div className="lead-card-top"><span className="grab-hint">···</span><span className="rating">{lead.rating ? <><Star size={12} fill="currentColor" /> {lead.rating}</> : "Novo"}</span></div><h4>{lead.name}</h4><p><MapPin size={13} /> {lead.city}, {lead.state}</p><div className="lead-card-footer"><span>{lead.segment}</span>{whatsappLink(lead.phone) ? <a href={whatsappLink(lead.phone)!} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()} title="Abrir WhatsApp"><MessageCircle size={16} /></a> : <span className="no-phone"><Phone size={14} /></span>}</div></article>)}</div></section>)}</div>}</article>
            </div>
          </section>
        )}

        {view === "settings" && (
          <section className="settings-page"><div className="settings-hero"><p className="eyebrow"><Settings size={15} /> IDENTIDADE DO UTILIZADOR</p><h1>Configurações de <em>conta.</em></h1><p>Atualize os seus dados e mantenha as credenciais protegidas.</p></div><div className="settings-grid"><article className="settings-card panel-glass"><div className="panel-heading"><div><p className="eyebrow">PERFIL</p><h3>Dados pessoais</h3></div><UserRound size={20} /></div><form onSubmit={event => { event.preventDefault(); profileMutation.mutate({ name: profileName, email: profileEmail }); }}><label>Nome<input value={profileName} onChange={e => setProfileName(e.target.value)} minLength={2} required /></label><label>Email<input type="email" value={profileEmail} onChange={e => setProfileEmail(e.target.value)} required /></label><button className="btn cosmic-primary" disabled={profileMutation.isPending}>{profileMutation.isPending ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />} Guardar perfil</button></form></article><article className="settings-card panel-glass"><div className="panel-heading"><div><p className="eyebrow">SEGURANÇA</p><h3>Alterar palavra-passe</h3></div><KeyRound size={20} /></div><form onSubmit={event => { event.preventDefault(); passwordMutation.mutate({ currentPassword, newPassword }); }}><label>Palavra-passe atual<input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required /></label><label>Nova palavra-passe<input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={8} required /></label><button className="btn cosmic-primary" disabled={passwordMutation.isPending}>{passwordMutation.isPending ? <Loader2 className="spin" size={16} /> : <LockKeyhole size={16} />} Atualizar palavra-passe</button></form></article></div></section>
        )}
      </section>

      {activeLeadId !== null && <div className="modal-backdrop" role="presentation" onMouseDown={() => setActiveLeadId(null)}><section className="lead-modal panel-glass" role="dialog" aria-modal="true" aria-label="Detalhes do lead" onMouseDown={event => event.stopPropagation()}><button className="modal-close" onClick={() => setActiveLeadId(null)} aria-label="Fechar detalhes"><X size={19} /></button>{detailQuery.isLoading ? <LoadingLine /> : detailQuery.isError ? <QueryError text="Não foi possível carregar os detalhes deste lead." onRetry={() => detailQuery.refetch()} /> : detailQuery.data ? <><div className="modal-lead-head"><div><p className="eyebrow">FICHA DO LEAD</p><h2>{detailQuery.data.lead.name}</h2><p><MapPin size={14} /> {detailQuery.data.lead.fullAddress ?? `${detailQuery.data.lead.city}, ${detailQuery.data.lead.state}`}</p></div><select className="modal-status" value={detailQuery.data.lead.status} onChange={event => statusMutation.mutate({ leadId: activeLeadId, status: event.target.value as PipelineStatus })}>{PIPELINE_STATUSES.map(status => <option key={status}>{status}</option>)}</select></div><div className="contact-links"><span><Phone size={16} /> {detailQuery.data.lead.phone ?? "Telefone indisponível"}</span>{detailQuery.data.lead.website && <a href={detailQuery.data.lead.website} target="_blank" rel="noreferrer"><Globe2 size={16} /> Website</a>}{whatsappLink(detailQuery.data.lead.phone) && <a className="whatsapp-link" href={whatsappLink(detailQuery.data.lead.phone)!} target="_blank" rel="noreferrer"><MessageCircle size={16} /> WhatsApp</a>}</div><div className="modal-grid"><div><h4>Notas internas</h4><form className="note-form" onSubmit={event => { event.preventDefault(); if (newNote.trim()) noteMutation.mutate({ leadId: activeLeadId, content: newNote }); }}><textarea value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Registe uma observação interna..." /><button className="btn subtle-btn" disabled={noteMutation.isPending}><Plus size={15} /> Adicionar nota</button></form><div className="note-list">{detailQuery.data.notes.length ? detailQuery.data.notes.map(note => <article key={note.id}>{editingNoteId === note.id ? <form className="note-form" onSubmit={event => { event.preventDefault(); if (editingNoteContent.trim()) updateNoteMutation.mutate({ noteId: note.id, content: editingNoteContent }); }}><textarea value={editingNoteContent} onChange={e => setEditingNoteContent(e.target.value)} aria-label="Editar nota" /><div><button className="btn subtle-btn" disabled={updateNoteMutation.isPending}>Guardar</button><button type="button" className="note-cancel" onClick={() => { setEditingNoteId(null); setEditingNoteContent(""); }}>Cancelar</button></div></form> : <><p>{note.content}</p><div className="note-meta"><small>{formatDate(note.updatedAt)}</small><button className="note-edit" onClick={() => { setEditingNoteId(note.id); setEditingNoteContent(note.content); }}>Editar</button></div></>}</article>) : <p className="empty-copy">Ainda não existem notas internas.</p>}</div></div><div><h4>Histórico de contactos</h4><form className="contact-form" onSubmit={event => { event.preventDefault(); contactMutation.mutate({ leadId: activeLeadId, channel: contactChannel, details: contactDetails || undefined }); }}><select value={contactChannel} onChange={e => setContactChannel(e.target.value)}><option>WhatsApp</option><option>Telefone</option><option>Email</option><option>Reunião</option><option>Outro</option></select><input value={contactDetails} onChange={e => setContactDetails(e.target.value)} placeholder="Detalhe opcional" /><button className="btn subtle-btn" disabled={contactMutation.isPending}><Plus size={15} /> Registar contacto</button></form><div className="contact-log">{detailQuery.data.contacts.length ? detailQuery.data.contacts.map(contact => <article key={contact.id}><span className="contact-icon"><MessageCircle size={14} /></span><div><strong>{contact.channel}</strong><p>{contact.details || "Contacto registado"}</p><small>{formatDate(contact.contactedAt)}</small></div></article>) : <p className="empty-copy">Nenhum contacto registado.</p>}</div></div></div></> : <EmptyState icon={<Users size={28} />} text="Lead não encontrado." />}</section></div>}
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
  const logout = trpc.auth.logout.useMutation({
    onSuccess: async () => { utils.auth.me.setData(undefined, null); await utils.auth.me.invalidate(); },
  });

  if (meQuery.isLoading) return <div className="initial-loader"><Rocket size={28} /><span>Preparar centro de comando...</span></div>;
  return <><Toaster richColors position="top-right" theme="dark" />{meQuery.data ? <AppShell user={meQuery.data} onLogout={() => logout.mutate()} /> : <AuthPage onAuthenticated={user => { utils.auth.me.setData(undefined, user); }} />}</>;
}

export default App;
