import { audio } from "./audio";
import { lockPointer, unlockPointer } from "./input";
import { net } from "./net";
import { esc } from "./hud";
import { state } from "./state";
import { EXTRA_ITEMS, HUMAN_CLASSES, ZOMBIE_CLASSES, type ClassDef, type ItemDef } from "../shared/balance";
import { WEAPONS, type WeaponDef } from "../shared/weapons";

// ===== Menu de compra estilo CS 1.6: categorias numeradas, dígitos navegam =====

const $ = (id: string) => document.getElementById(id)!;

type Category = { key: number; label: string; weapons?: WeaponDef[]; classes?: ClassDef[]; items?: ItemDef[] };

const byIds = (ids: string[]) => ids.map((id) => WEAPONS[id]).filter(Boolean);

function categories(): Category[] {
  const team = state.team;
  const items = EXTRA_ITEMS.filter((i) => i.side === team || i.side === "both");
  const classes = team === "human" ? HUMAN_CLASSES : ZOMBIE_CLASSES;
  if (team === "zombie") {
    return [
      { key: 5, label: "Classe", classes },
      { key: 6, label: "Itens extras (AP)", items },
    ];
  }
  return [
    { key: 1, label: "Pistolas", weapons: byIds(["usp", "glock", "deagle"]) },
    { key: 2, label: "Escopetas", weapons: byIds(["m3", "xm1014"]) },
    { key: 3, label: "SMG", weapons: byIds(["mp5"]) },
    { key: 4, label: "Rifles / Sniper", weapons: byIds(["ak47", "m4a1", "awp", "m249"]) },
    { key: 5, label: "Classe", classes },
    { key: 6, label: "Itens extras (AP)", items },
  ];
}

let current: Category | null = null;

export function toggleShop(force?: boolean) {
  if (state.id < 0) return;
  const next = force ?? !state.ui.shopOpen;
  if (next === state.ui.shopOpen) return;
  state.ui.shopOpen = next;
  $("shop").classList.toggle("hidden", !next);
  if (next) {
    current = null;
    renderShop();
    unlockPointer();
  } else {
    lockPointer();
  }
}

/** Dígito pressionado com o menu aberto. Retorna true se foi consumido. */
export function shopDigit(d: number): boolean {
  if (!state.ui.shopOpen) return false;
  if (d === 0) {
    if (current) {
      current = null;
      renderShop();
    } else toggleShop(false);
    return true;
  }
  if (!current) {
    const cat = categories().find((c) => c.key === d);
    if (cat) {
      current = cat;
      renderShop();
    }
    return true;
  }
  const rows = currentRows();
  const row = rows[d - 1];
  if (row) row.action();
  return true;
}

interface Row {
  label: string;
  meta: string;
  disabled: boolean;
  selected: boolean;
  action(): void;
}

function currentRows(): Row[] {
  const c = current;
  if (!c) return [];
  if (c.weapons) {
    const locked = state.me && HUMAN_CLASSES.find((h) => h.id === state.me!.classId)?.lockedWeapon;
    return c.weapons.map((w) => ({
      label: w.name,
      meta: `${w.dmg} dmg · ${w.fireRate.toFixed(1)}/s · ${w.magazine}/${w.reserve}${w.zoom ? " · zoom" : ""} — ${w.desc}`,
      disabled: !!locked && w.slot === 1,
      selected: state.slots.includes(w.id),
      action: () => buyWeapon(w.id),
    }));
  }
  if (c.classes) {
    return c.classes.map((cl) => ({
      label: cl.name,
      meta: `HP ${cl.hp} · Vel ${Math.round(cl.speed * 100)}% · ${cl.ability} — ${cl.desc}`,
      disabled: false,
      selected: state.me?.classId === cl.id,
      action: () => {
        net.send({ t: "selectClass", d: { classId: cl.id } });
        audio.buy();
      },
    }));
  }
  if (c.items) {
    return c.items.map((it) => ({
      label: it.name,
      meta: `${it.cost} AP — ${it.desc}`,
      disabled: state.ap < it.cost || state.owned.has(it.id),
      selected: state.owned.has(it.id),
      action: () => {
        if (state.ap < it.cost || state.owned.has(it.id)) return;
        net.send({ t: "buy", d: { itemId: it.id } });
      },
    }));
  }
  return [];
}

function buyWeapon(id: string) {
  net.send({ t: "buyWeapon", d: { weaponId: id } });
  audio.buy();
}

export function renderShop() {
  if (!state.ui.shopOpen) return;
  $("shop-ap").textContent = String(state.ap);
  const list = $("shop-list");
  list.innerHTML = "";
  if (!current) {
    $("shop-title").textContent = "COMPRAR";
    $("shop-hint").textContent = "Dígito escolhe · 0/Esc fecha";
    for (const c of categories()) list.appendChild(rowEl(c.key, c.label, "", false, false, () => shopDigit(c.key)));
    return;
  }
  $("shop-title").textContent = current.label.toUpperCase();
  $("shop-hint").textContent = "0. Voltar · B/Esc fechar";
  currentRows().forEach((r, i) => list.appendChild(rowEl(i + 1, r.label, r.meta, r.disabled, r.selected, r.action)));
}

function rowEl(n: number, label: string, meta: string, disabled: boolean, selected: boolean, action: () => void): HTMLElement {
  const el = document.createElement("div");
  el.className = "buy-row" + (disabled ? " disabled" : "") + (selected ? " selected" : "");
  el.innerHTML = `<span class="n">${n}.</span><span class="label">${esc(label)}</span>${meta ? `<span class="meta">${esc(meta)}</span>` : ""}`;
  el.addEventListener("click", () => {
    if (!disabled) action();
  });
  return el;
}
