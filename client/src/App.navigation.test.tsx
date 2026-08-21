// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { AppNavigation, applyKanbanMove, ExportActions, LeadStatusSelect, NoteComposer } from "./App";

describe("navegação principal do CRM", () => {
  it("apresenta os quatro destinos obrigatórios e transmite o destino escolhido", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<AppNavigation view="dashboard" onNavigate={onNavigate} />);

    const labels = ["Dashboard", "Buscar Leads", "Meu CRM", "Configurações"];
    labels.forEach(label => expect(screen.getByRole("button", { name: label })).toBeVisible());
    expect(screen.getByRole("button", { name: "Dashboard" })).toHaveClass("active");

    await user.click(screen.getByRole("button", { name: "Meu CRM" }));
    expect(onNavigate).toHaveBeenCalledWith("crm");
  });
});

describe("controlos interativos do CRM", () => {
  it("dispara as exportações CSV e XLSX pela interface", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    render(<ExportActions pending={false} onExport={onExport} />);

    await user.click(screen.getByRole("button", { name: "CSV" }));
    await user.click(screen.getByRole("button", { name: "XLSX" }));
    expect(onExport).toHaveBeenNthCalledWith(1, "csv");
    expect(onExport).toHaveBeenNthCalledWith(2, "xlsx");
  });

  it("permite alterar status e submeter uma nota através dos controlos do modal", async () => {
    const user = userEvent.setup();
    const onStatusChange = vi.fn();
    const onAdd = vi.fn();
    const onChange = vi.fn();
    render(<><LeadStatusSelect status="Novo" onStatusChange={onStatusChange} /><NoteComposer value="Nota de teste" pending={false} onChange={onChange} onAdd={onAdd} /></>);

    await user.selectOptions(screen.getByRole("combobox"), "Fechado");
    await user.click(screen.getByRole("button", { name: /adicionar nota/i }));
    expect(onStatusChange).toHaveBeenCalledWith("Fechado");
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("move um lead apenas quando o destino do Kanban é diferente da origem", () => {
    const onMove = vi.fn();
    applyKanbanMove({ leadId: 23, fromStatus: "Novo", nextStatus: "Contatado", onMove });
    applyKanbanMove({ leadId: 23, fromStatus: "Contatado", nextStatus: "Contatado", onMove });

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith(23, "Contatado");
  });
});
