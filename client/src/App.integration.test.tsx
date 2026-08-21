// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sortableMock = vi.hoisted(() => ({ create: vi.fn(() => ({ destroy: vi.fn() })) }));
const trpcMocks = vi.hoisted(() => {
  const lead = { id: 31, name: "Empresa Teste", phone: "+351 220 000 000", fullAddress: "Rua do CRM, Porto", website: "https://empresa.test", rating: "4.8", businessStatus: "Aberto", status: "Novo", segment: "Restaurantes", city: "Porto", state: "PT", createdAt: new Date(), updatedAt: new Date() };
  const query = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: vi.fn() });
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  return {
    lead,
    status: mutation(), note: mutation(), contact: mutation(), updateNote: mutation(), export: mutation(), search: mutation(), rerun: mutation(), profile: mutation(), password: mutation(),
    trpc: {
      useUtils: () => ({ leads: { list: { invalidate: vi.fn() }, metrics: { invalidate: vi.fn() }, details: { invalidate: vi.fn() } }, places: { history: { invalidate: vi.fn() } }, auth: { me: { invalidate: vi.fn() } } }),
      leads: {
        list: { useQuery: () => query([lead]) }, metrics: { useQuery: () => query({ total: 1, byStatus: [{ status: "Novo", count: 1 }] }) }, details: { useQuery: () => query({ lead, notes: [], contacts: [] }) },
        updateStatus: { useMutation: () => trpcMocks.status }, addNote: { useMutation: () => trpcMocks.note }, addContact: { useMutation: () => trpcMocks.contact }, updateNote: { useMutation: () => trpcMocks.updateNote }, export: { useMutation: () => trpcMocks.export },
      },
      places: { history: { useQuery: () => query([]) }, search: { useMutation: () => trpcMocks.search }, rerun: { useMutation: () => trpcMocks.rerun } },
      auth: { updateProfile: { useMutation: () => trpcMocks.profile }, changePassword: { useMutation: () => trpcMocks.password } },
    },
  };
});

vi.mock("sortablejs", () => ({ default: sortableMock }));
vi.mock("@/lib/trpc", () => ({ trpc: trpcMocks.trpc }));

import { AppShell } from "./App";

describe("painel autenticado integrado", () => {
  beforeEach(() => vi.clearAllMocks());

  it("navega pela sidebar e executa ações de CRM no ecrã real", async () => {
    const user = userEvent.setup();
    render(<AppShell user={{ id: 1, name: "Conta Real", email: "conta@empresa.pt", role: "user" }} onLogout={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Buscar Leads" }));
    expect(screen.getByRole("heading", { name: /defina a sua próxima/i })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Meu CRM" }));
    expect(screen.getAllByRole("heading", { name: /meu crm/i }).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "CSV" }));
    expect(trpcMocks.export.mutate).toHaveBeenCalledWith(expect.objectContaining({ format: "csv" }));

    await user.click(screen.getByRole("button", { name: /empresa teste/i }));
    const dialog = screen.getByRole("dialog", { name: "Detalhes do lead" });
    const modal = within(dialog);
    await user.selectOptions(modal.getAllByRole("combobox")[0], "Fechado");
    expect(trpcMocks.status.mutate).toHaveBeenCalledWith({ leadId: 31, status: "Fechado" });
    await user.type(modal.getByPlaceholderText("Registe uma observação interna..."), "Contactar amanhã");
    await user.click(modal.getByRole("button", { name: /adicionar nota/i }));
    expect(trpcMocks.note.mutate).toHaveBeenCalledWith({ leadId: 31, content: "Contactar amanhã" });
    await user.type(modal.getByPlaceholderText("Detalhe opcional"), "Mensagem enviada");
    await user.click(modal.getByRole("button", { name: /registar contacto/i }));
    expect(trpcMocks.contact.mutate).toHaveBeenCalledWith({ leadId: 31, channel: "WhatsApp", details: "Mensagem enviada" });

    type SortableCallbackOptions = { onEnd: (event: { item: { dataset: { leadId?: string } }; from: { dataset: { status?: string } }; to: { dataset: { status?: string } } }) => void };
    const sortableCalls = (sortableMock.create as unknown as { mock: { calls: Array<[HTMLElement, SortableCallbackOptions]> } }).mock.calls;
    const kanbanCall = sortableCalls.find(([element]) => element.dataset.status === "Contatado");
    expect(kanbanCall).toBeTruthy();
    kanbanCall?.[1].onEnd({ item: { dataset: { leadId: "31" } }, from: { dataset: { status: "Novo" } }, to: { dataset: { status: "Contatado" } } });
    expect(trpcMocks.status.mutate).toHaveBeenCalledWith({ leadId: 31, status: "Contatado" });
  });
});
