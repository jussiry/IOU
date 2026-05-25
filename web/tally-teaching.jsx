import React, { useState, useEffect, useMemo } from "react";
import {
  ArrowRight,
  Plus,
  Coffee,
  Check,
  X,
  Repeat,
  Lock,
  Globe,
  Sparkles,
  RotateCcw,
  Send,
  Pizza,
  Clock,
  Euro,
  Wrench,
  Heart,
  ChevronRight,
  CircleDot,
  Bitcoin,
} from "lucide-react";

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600;9..144,700;9..144,900&family=Crimson+Pro:ital,wght@0,300;0,400;0,500;0,600;1,400&family=JetBrains+Mono:wght@400;500;700&display=swap');

:root {
  --parchment: #f1e6cf;
  --parchment-dark: #e6d8b8;
  --parchment-edge: #c8b58c;
  --ink: #271708;
  --ink-soft: #4a3520;
  --ink-muted: #7a6a4f;
  --burgundy: #7d2538;
  --burgundy-soft: #a64458;
  --moss: #4a5c3a;
  --moss-soft: #6a7d5a;
  --gold: #b8924c;
  --rust: #c2502c;
}

* { box-sizing: border-box; }

html, body, #root { background: var(--parchment); }

.font-display { font-family: 'Fraunces', Georgia, serif; font-feature-settings: "ss01", "ss02"; }
.font-body { font-family: 'Crimson Pro', Georgia, serif; }
.font-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }

.paper {
  background-color: var(--parchment);
  background-image:
    radial-gradient(circle at 18% 22%, rgba(184, 146, 76, 0.10) 0%, transparent 38%),
    radial-gradient(circle at 82% 70%, rgba(125, 37, 56, 0.07) 0%, transparent 42%),
    radial-gradient(circle at 50% 50%, rgba(74, 92, 58, 0.04) 0%, transparent 65%);
}

.grain {
  position: relative;
}
.grain::before {
  content: "";
  position: absolute; inset: 0;
  pointer-events: none;
  opacity: 0.35;
  mix-blend-mode: multiply;
  background-image:
    radial-gradient(rgba(74, 53, 32, 0.10) 1px, transparent 1px),
    radial-gradient(rgba(74, 53, 32, 0.06) 1px, transparent 1px);
  background-size: 3px 3px, 7px 7px;
  background-position: 0 0, 1px 2px;
}

.deckle {
  border-image: none;
  box-shadow:
    0 1px 0 rgba(74, 53, 32, 0.05) inset,
    0 0 0 1px rgba(74, 53, 32, 0.10),
    0 12px 24px -16px rgba(39, 23, 8, 0.35);
}

.rule-thin { background: linear-gradient(to right, transparent, rgba(74, 53, 32, 0.4), transparent); height: 1px; }

@keyframes notchIn {
  0% { transform: scaleY(0) translateX(0); opacity: 0; }
  60% { transform: scaleY(1.15) translateX(0); opacity: 1; }
  100% { transform: scaleY(1) translateX(0); opacity: 1; }
}
.notch-in { animation: notchIn 0.45s cubic-bezier(0.2, 0.8, 0.2, 1) forwards; transform-origin: top; }

@keyframes inkDrop {
  0% { transform: scale(0.4); opacity: 0; }
  70% { transform: scale(1.05); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
.ink-in { animation: inkDrop 0.5s ease-out forwards; }

@keyframes drift {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-6px); }
}
.drift { animation: drift 6s ease-in-out infinite; }

@keyframes dashflow {
  to { stroke-dashoffset: -200; }
}
.dashflow { animation: dashflow 4s linear infinite; }

@keyframes glow {
  0%, 100% { filter: drop-shadow(0 0 0px rgba(184, 146, 76, 0.0)); }
  50% { filter: drop-shadow(0 0 14px rgba(184, 146, 76, 0.7)); }
}
.glow { animation: glow 1.6s ease-in-out infinite; }

@keyframes fadeOut {
  to { opacity: 0; }
}
.fade-out { animation: fadeOut 0.9s ease-out forwards; }

.btn {
  font-family: 'Crimson Pro', Georgia, serif;
  font-weight: 500;
  letter-spacing: 0.02em;
  transition: all 0.2s ease;
}

.tab-divot {
  background:
    linear-gradient(180deg, rgba(74, 53, 32, 0.0) 0%, rgba(74, 53, 32, 0.15) 100%);
}

.serif-num { font-family: 'Fraunces', Georgia, serif; font-feature-settings: "tnum", "lnum"; }

.underline-wavy {
  text-decoration: underline wavy rgba(125, 37, 56, 0.55);
  text-underline-offset: 6px;
  text-decoration-thickness: 1.5px;
}

.shadow-ink {
  box-shadow:
    0 1px 0 rgba(255, 248, 220, 0.4) inset,
    0 0 0 1px rgba(74, 53, 32, 0.18),
    0 6px 14px -8px rgba(39, 23, 8, 0.35);
}

.cta-stamp {
  background:
    radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.18), transparent 40%),
    var(--burgundy);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.18),
    inset 0 -2px 0 rgba(0,0,0,0.18),
    0 8px 22px -12px rgba(125, 37, 56, 0.7);
}

.cta-stamp:hover { transform: translateY(-1px); box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.18),
    inset 0 -2px 0 rgba(0,0,0,0.18),
    0 14px 28px -10px rgba(125, 37, 56, 0.7); }

.section-num {
  font-family: 'Fraunces', Georgia, serif;
  font-weight: 300;
  font-style: italic;
  font-feature-settings: "lnum";
}
`;

/* -------------------------------------------------- */
/* HERO with animated tally stick                     */
/* -------------------------------------------------- */
function Hero() {
  const [notches, setNotches] = useState([1, 1, 1]);

  return (
    <section className="relative paper grain overflow-hidden">
      <div className="max-w-6xl mx-auto px-6 pt-16 pb-24 md:pt-24 md:pb-32">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-2 h-2 rounded-full bg-[var(--burgundy)]" />
          <span className="font-mono uppercase tracking-[0.25em] text-xs text-[var(--ink-muted)]">
            tally.earth · interactive primer
          </span>
        </div>

        <h1 className="font-display font-light leading-[0.92] tracking-tight text-[var(--ink)] text-[clamp(2.6rem,8vw,6.5rem)]">
          Money,
          <br />
          rooted in <em className="italic font-normal underline-wavy">trust.</em>
        </h1>

        <p className="font-body text-[var(--ink-soft)] mt-8 max-w-xl text-xl md:text-2xl leading-snug">
          A guided walkthrough of Tally — a peer-to-peer favour ledger that
          works the way communities have kept books for thousands of years.
          Click, poke, and explore each idea below.
        </p>

        {/* Animated tally stick */}
        <div className="mt-16 md:mt-20 relative">
          <div className="text-xs font-mono uppercase tracking-widest text-[var(--ink-muted)] mb-3">
            ↓ tap the stick
          </div>
          <TallyStickInteractive notches={notches} setNotches={setNotches} />
        </div>

        <div className="mt-14 flex items-center gap-6 text-sm font-mono text-[var(--ink-muted)]">
          <span>scroll</span>
          <div className="w-16 h-px bg-[var(--ink-muted)] opacity-40" />
          <span>8 chapters</span>
        </div>
      </div>
    </section>
  );
}

function TallyStickInteractive({ notches, setNotches }) {
  const total = notches.reduce((a, b) => a + b, 0);
  const addNotch = () => setNotches((n) => [...n, 1]);
  const reset = () => setNotches([1, 1, 1]);

  return (
    <div className="relative">
      <div className="flex flex-col gap-2 select-none">
        {/* Top half (creditor) */}
        <StickHalf
          label="Your half"
          sublabel="creditor"
          notches={notches}
          flip={false}
        />
        {/* Bottom half (debtor) */}
        <StickHalf
          label="Their half"
          sublabel="debtor"
          notches={notches}
          flip={true}
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          onClick={addNotch}
          className="btn cta-stamp text-[var(--parchment)] px-5 py-2.5 rounded-full font-display text-base"
        >
          + add a notch
        </button>
        <button
          onClick={reset}
          className="btn px-4 py-2.5 rounded-full text-sm text-[var(--ink-soft)] hover:bg-[var(--parchment-dark)] inline-flex items-center gap-2"
        >
          <RotateCcw size={14} />
          reset
        </button>
        <span className="font-mono text-sm text-[var(--ink-muted)] ml-2">
          {total} matching marks · split between two
        </span>
      </div>
    </div>
  );
}

function StickHalf({ label, sublabel, notches, flip }) {
  return (
    <div className="relative">
      <div className="flex items-center gap-4 mb-2">
        <span className="font-display italic text-[var(--ink-soft)] text-lg">
          {label}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--ink-muted)]">
          {sublabel}
        </span>
      </div>
      <div
        className="relative h-16 md:h-20 rounded-md shadow-ink overflow-hidden"
        style={{
          background:
            "linear-gradient(180deg, #c69a64 0%, #a87842 50%, #8a5e30 100%)",
        }}
      >
        {/* wood grain */}
        <div
          className="absolute inset-0 opacity-30 mix-blend-multiply"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, rgba(60, 30, 10, 0.4) 0 1px, transparent 1px 7px), repeating-linear-gradient(180deg, rgba(60, 30, 10, 0.15) 0 1px, transparent 1px 4px)",
          }}
        />
        {/* notches */}
        <div className="absolute inset-x-0 flex items-end gap-3 px-6"
          style={{ top: flip ? "auto" : 0, bottom: flip ? 0 : "auto", height: "62%" }}>
          {notches.map((_, i) => (
            <div
              key={i}
              className={`notch-in flex-shrink-0`}
              style={{
                width: 5,
                height: "100%",
                background:
                  "linear-gradient(180deg, rgba(20,10,0,0.75), rgba(40,20,5,0.4))",
                borderRadius: 1,
                transform: flip ? "scaleY(-1)" : "none",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------- */
/* CHAPTER WRAPPER                                    */
/* -------------------------------------------------- */
function Chapter({ num, kicker, title, children, accent = "burgundy" }) {
  const accentColor =
    accent === "burgundy"
      ? "var(--burgundy)"
      : accent === "moss"
      ? "var(--moss)"
      : "var(--gold)";
  return (
    <section className="relative">
      <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
        <div className="flex items-baseline gap-5 mb-3">
          <span
            className="section-num text-3xl md:text-4xl"
            style={{ color: accentColor }}
          >
            {num}
          </span>
          <span className="font-mono uppercase tracking-[0.25em] text-xs text-[var(--ink-muted)]">
            {kicker}
          </span>
        </div>
        <h2 className="font-display text-[var(--ink)] text-4xl md:text-5xl leading-[1.05] tracking-tight max-w-3xl mb-12">
          {title}
        </h2>
        {children}
      </div>
      <div className="rule-thin max-w-6xl mx-auto" />
    </section>
  );
}

/* -------------------------------------------------- */
/* CHAPTER 1 — The ancient idea                       */
/* -------------------------------------------------- */
function ChapterAncient() {
  return (
    <Chapter
      num="01"
      kicker="The ancient idea"
      title={
        <>
          A piece of wood, <em className="italic">split</em> between two —
          a debt that <em className="italic">cannot lie.</em>
        </>
      }
    >
      <div className="grid md:grid-cols-12 gap-10 items-start">
        <div className="md:col-span-7 space-y-5 font-body text-lg leading-relaxed text-[var(--ink-soft)]">
          <p>
            For most of human history, money was not coin or paper. It was{" "}
            <span className="text-[var(--ink)] font-semibold">memory</span> —
            kept in shared records between people who knew each other.
          </p>
          <p>
            One of the most elegant of these tools was the{" "}
            <span className="font-display italic text-[var(--ink)]">
              tally stick
            </span>
            : a hazel rod marked with notches, then cleft lengthwise. The
            creditor kept one half, the debtor the other. To verify, you
            simply matched them. Tampering was visible at a glance.
          </p>
          <p>
            Tally borrows the name and the principle. Each favour you record
            exists as <em>two matching halves</em> — yours and theirs. No
            central book. No bank in the middle.
          </p>
        </div>

        <div className="md:col-span-5">
          <div className="paper grain rounded-lg p-6 deckle">
            <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--ink-muted)] mb-3">
              compared
            </div>
            <div className="space-y-3 font-body text-[var(--ink-soft)]">
              <CompareRow label="Tally stick">two matching halves of wood</CompareRow>
              <CompareRow label="Hawala">honour-bound brokers, shared ledger</CompareRow>
              <CompareRow label="Quipu">knotted cords, paired records</CompareRow>
              <CompareRow label="Tally.earth">
                <span className="text-[var(--burgundy)]">cryptographic notches, peer-to-peer</span>
              </CompareRow>
            </div>
          </div>
        </div>
      </div>
    </Chapter>
  );
}

function CompareRow({ label, children }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 items-baseline border-b border-[var(--ink-muted)]/20 pb-2 last:border-0">
      <span className="font-display italic text-[var(--ink)]">{label}</span>
      <span className="text-base">{children}</span>
    </div>
  );
}

/* -------------------------------------------------- */
/* CHAPTER 2 — Record a favour (interactive)          */
/* -------------------------------------------------- */
// fromSam: true  → Sam did this for you  (you owe Sam)
// fromSam: false → you did this for Sam  (Sam owes you)
const SAM_HELPED_YOU = [
  { icon: Pizza,  label: "shared a pizza",     amount: 12, unit: "EUR",  fromSam: true },
  { icon: Wrench, label: "fixed the bike",     amount: 1,  unit: "HOUR", fromSam: true },
  { icon: Heart,  label: "helped you move",    amount: 3,  unit: "HOUR", fromSam: true },
];

const YOU_HELPED_SAM = [
  { icon: Send,   label: "covered the ride",    amount: 8,  unit: "EUR",  fromSam: false },
  { icon: Wrench, label: "fixed Sam's shelf",   amount: 1,  unit: "HOUR", fromSam: false },
  { icon: Heart,  label: "walked Sam's dog",    amount: 2,  unit: "HOUR", fromSam: false },
];

function FavourRow({ favours, onAdd }) {
  return (
    <div className="flex flex-wrap gap-3">
      {favours.map((f, i) => {
        const Icon = f.icon;
        const who = f.fromSam ? "Sam" : "You";
        const hoverColor = f.fromSam ? "hover:bg-[var(--burgundy)]/10" : "hover:bg-[var(--moss)]/10";
        const iconColor = f.fromSam ? "var(--burgundy)" : "var(--moss)";
        return (
          <button
            key={i}
            onClick={() => onAdd(f)}
            className={`btn group inline-flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-[var(--parchment-dark)] ${hoverColor} text-[var(--ink)] shadow-ink`}
          >
            <Icon size={16} style={{ color: iconColor }} />
            <span className="font-display italic">{who} {f.label}</span>
            <span className="font-mono text-xs text-[var(--ink-muted)] group-hover:text-[var(--ink)]">
              {f.amount} {f.unit.toLowerCase()}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ChapterRecord() {
  const [tallies, setTallies] = useState([]);

  // Positive = you owe Sam, negative = Sam owes you
  const balance = tallies.reduce((acc, t) => {
    acc[t.unit] = (acc[t.unit] || 0) + (t.fromSam ? t.amount : -t.amount);
    return acc;
  }, {});

  const add = (f) =>
    setTallies((prev) => [...prev, { ...f, ts: Date.now(), id: Math.random().toString(36).slice(2) }]);
  const reset = () => setTallies([]);

  return (
    <Chapter
      num="02"
      kicker="Record a favour"
      title={
        <>
          Every favour gets <em className="italic">notched on the stick</em> — and both have their sides of it.
        </>
      }
    >
      <p className="font-body text-lg text-[var(--ink-soft)] max-w-2xl mb-8 leading-relaxed">
        Tap a favour to log it. Each entry appears on both ledgers with opposite signs —
        watch the net balance shift as the story between you and Sam unfolds.
      </p>

      {/* Quick-pick favours */}
      <div className="space-y-4 mb-8">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--burgundy)] mb-2">
            Sam helped you
          </div>
          <FavourRow favours={SAM_HELPED_YOU} onAdd={add} />
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--moss)] mb-2">
            You helped Sam
          </div>
          <FavourRow favours={YOU_HELPED_SAM} onAdd={add} />
        </div>
        {tallies.length > 0 && (
          <button
            onClick={reset}
            className="btn inline-flex items-center gap-2 px-3 py-2 rounded-full text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]"
          >
            <RotateCcw size={12} /> clear ledgers
          </button>
        )}
      </div>

      {/* Two ledgers */}
      <div className="grid md:grid-cols-2 gap-5 md:gap-8">
        <Ledger owner="You"  subtitle="kept on your phone"  tallies={tallies} perspective="you"  accent="burgundy" />
        <Ledger owner="Sam"  subtitle="kept on Sam's phone" tallies={tallies} perspective="sam"  accent="moss" />
      </div>

      {tallies.length > 0 && (
        <div className="mt-8 p-5 rounded-lg bg-[var(--parchment-dark)] shadow-ink">
          <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--ink-muted)] mb-2">
            Net balance with Sam
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-2 font-display">
            {Object.entries(balance).map(([unit, amt]) => {
              const owes = amt > 0 ? "you owe Sam" : amt < 0 ? "Sam owes you" : "settled";
              const color = amt > 0 ? "var(--burgundy)" : amt < 0 ? "var(--moss)" : "var(--ink-muted)";
              return (
                <div key={unit} className="flex items-baseline gap-2">
                  <span className="serif-num text-3xl" style={{ color }}>{Math.abs(amt)}</span>
                  <span className="text-sm text-[var(--ink-muted)] uppercase tracking-wider font-mono">{unit.toLowerCase()}</span>
                  <span className="text-xs italic text-[var(--ink-muted)] ml-2">{owes}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Chapter>
  );
}

// perspective: "you" → positive means Sam owes you; "sam" → positive means you owe Sam
function Ledger({ owner, subtitle, tallies, perspective, accent }) {
  const accentColor = accent === "burgundy" ? "var(--burgundy)" : "var(--moss)";
  return (
    <div className="rounded-lg deckle paper grain p-6 min-h-[320px] flex flex-col">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="font-display text-2xl text-[var(--ink)]">
          {owner}
          <span className="text-[var(--ink-muted)] italic font-light">
            's ledger
          </span>
        </h3>
        <span
          className="font-mono text-[10px] uppercase tracking-widest"
          style={{ color: accentColor }}
        >
          local · private
        </span>
      </div>
      <div className="text-xs text-[var(--ink-muted)] italic mb-4">
        {subtitle}
      </div>
      <div className="rule-thin mb-3" />

      <div className="flex-1 ledger-line space-y-0">
        {tallies.length === 0 && (
          <div className="text-[var(--ink-muted)] italic text-sm">
            …no entries yet. Notch a favour to begin.
          </div>
        )}
        {tallies.map((t) => {
          const Icon = t.icon;
          // From "you" perspective: Sam helping you is negative (debt), you helping Sam is positive (credit)
          // From "sam" perspective: the opposite
          const v = perspective === "you"
            ? (t.fromSam ? -t.amount : +t.amount)
            : (t.fromSam ? +t.amount : -t.amount);
          const who = t.fromSam ? "Sam" : "You";
          return (
            <div
              key={t.id}
              className="ink-in flex items-baseline justify-between text-base"
              style={{ height: "1.6em" }}
            >
              <span className="flex items-baseline gap-2 truncate">
                <Icon
                  size={13}
                  style={{ color: t.fromSam ? "var(--burgundy)" : "var(--moss)", transform: "translateY(2px)" }}
                />
                <span className="text-[var(--ink-soft)] truncate">
                  {who} {t.label}
                </span>
              </span>
              <span
                className="font-mono text-sm font-medium tabular-nums"
                style={{ color: v < 0 ? "var(--burgundy)" : "var(--moss)" }}
              >
                {v > 0 ? "+" : ""}
                {v} {t.unit.toLowerCase()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------- */
/* CHAPTER 3 — Choose your unit                       */
/* -------------------------------------------------- */
const UNITS = [
  { id: "eur",  label: "Euro",    icon: Euro,    factor: 1,      name: "EUR",  note: "Familiar fiat unit" },
  { id: "hour", label: "Hour",    icon: Clock,   factor: 0.05,   name: "HOUR", note: "Time-based exchange" },
  { id: "meal", label: "Meal",    icon: Pizza,   factor: 2 / 60, name: "MEAL", note: "Home-cooked dinners" },
  { id: "fav",  label: "Favour",  icon: Repeat,  factor: 1 / 60, name: "FAV", note: "Friend based favour" },
];

function ChapterUnits() {
  const [unit, setUnit] = useState(UNITS[0]);
  const baseAmount = 60;
  // Round to 4 significant decimal places to avoid floating-point noise
  // e.g. 60 * (2/60) = 1.9999999999999998 → rounds cleanly to 2
  const display = useMemo(() => {
    const raw = baseAmount * unit.factor;
    return Math.round(raw * 10000) / 10000;
  }, [unit]);

  const displayStr = display % 1 === 0 ? String(display) : display.toFixed(display < 0.1 ? 4 : 2);

  return (
    <Chapter
      num="03"
      kicker="Choose your unit"
      title={
        <>
          The same favour, in <em className="italic">whatever language</em>{" "}
          you and your friend agree on.
        </>
      }
      accent="moss"
    >
      <p className="font-body text-lg text-[var(--ink-soft)] max-w-2xl mb-10 leading-relaxed">
        Tally is unit-agnostic. Money has always been a
        story two people tell each other; you choose the words. Switch the
        unit below — the favour itself doesn't change.
      </p>

      <div className="grid md:grid-cols-12 gap-10 items-center">
        <div className="md:col-span-5">
          <div className="rounded-lg deckle paper grain p-7">
            <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--ink-muted)] mb-2">
              The favour
            </div>
            <p className="font-display italic text-2xl text-[var(--ink)] leading-snug mb-6">
              Maria helped Pekka rebuild his garden shed last weekend.
            </p>
            <div className="rule-thin mb-6" />
            <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--ink-muted)] mb-2">
              Recorded as
            </div>
            <div className="flex items-baseline gap-3">
              <span className="serif-num text-6xl md:text-7xl text-[var(--burgundy)] font-light">
                {displayStr}
              </span>
              <div className="flex flex-col">
                <span className="font-display text-xl text-[var(--ink)]">
                  {unit.label}
                  {display === 1 ? "" : "s"}
                </span>
                <span className="font-mono text-xs text-[var(--ink-muted)]">
                  {unit.note}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="md:col-span-7">
          <div className="grid grid-cols-2 gap-3">
            {UNITS.map((u) => {
              const Icon = u.icon;
              const active = unit.id === u.id;
              return (
                <button
                  key={u.id}
                  onClick={() => setUnit(u)}
                  className={`btn group text-left p-5 rounded-lg transition-all ${
                    active
                      ? "bg-[var(--ink)] text-[var(--parchment)] shadow-ink"
                      : "bg-[var(--parchment-dark)] text-[var(--ink)] hover:bg-[var(--gold)]/25"
                  }`}
                >
                  <Icon
                    size={22}
                    className={
                      active
                        ? "text-[var(--gold)] mb-3"
                        : "text-[var(--burgundy)] mb-3"
                    }
                  />
                  <div className="font-display text-2xl mb-1">{u.label}</div>
                  <div
                    className={`font-mono text-[10px] uppercase tracking-widest ${
                      active ? "text-[var(--parchment-edge)]" : "text-[var(--ink-muted)]"
                    }`}
                  >
                    {u.note}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="font-body italic text-[var(--ink-muted)] mt-5 text-sm">
            Two friends might track favours in <em>cups of coffee</em>;
            a co-op might denominate in <em>weeded rows</em>. Tally doesn't care.
          </p>
        </div>
      </div>
    </Chapter>
  );
}

/* -------------------------------------------------- */
/* CHAPTER 4 — Chained trust                          */
/* -------------------------------------------------- */
function ChapterChain() {
  const [stage, setStage] = useState(0);
  // 0: idle  1: A→B drawn  2: B→C drawn  3: settled

  const next = () => setStage((s) => Math.min(s + 1, 3));
  const reset = () => setStage(0);

  const balances = useMemo(() => {
    if (stage === 0) return { A: 0, B: 0, C: 0 };
    if (stage === 1) return { A: -10, B: +10, C: 0 };
    if (stage === 2) return { A: -10, B: 0, C: +10 };
    return { A: -10, B: 0, C: +10 };
  }, [stage]);

  return (
    <Chapter
      num="04"
      kicker="Chained trust"
      title={
        <>
          Reach a stranger through a <em className="italic">chain of friends.</em>
        </>
      }
    >
      <div className="grid md:grid-cols-12 gap-10">
        <div className="md:col-span-5 space-y-5 font-body text-lg text-[var(--ink-soft)] leading-relaxed">
          <p>
            <span className="font-display italic text-[var(--ink)]">Alice</span>{" "}
            and{" "}
            <span className="font-display italic text-[var(--ink)]">Bob</span>{" "}
            trust each other. Bob and{" "}
            <span className="font-display italic text-[var(--ink)]">Charlie</span>{" "}
            trust each other. Alice has never met Charlie — and yet she
            wants to send him €10.
          </p>
          <p>
            Tally finds the path. Alice records a tally with Bob. Bob,
            in the same instant, records one of equal value with Charlie. Bob's
            balance never moves; he is just a conduit.
          </p>
          <p className="text-[var(--ink-muted)] italic">
            The longer your trust graph, the further your favours can travel.
          </p>

          <div className="pt-4 flex flex-wrap gap-3">
            <button
              onClick={next}
              disabled={stage === 3}
              className={`btn inline-flex items-center gap-2 px-5 py-2.5 rounded-full font-display text-base ${
                stage === 3
                  ? "bg-[var(--parchment-dark)] text-[var(--ink-muted)] cursor-not-allowed"
                  : "cta-stamp text-[var(--parchment)]"
              }`}
            >
              {stage === 0 && (
                <>
                  Send €10 from Alice to Charlie <ChevronRight size={16} />
                </>
              )}
              {stage === 1 && (
                <>
                  Now route through Bob → Charlie <ChevronRight size={16} />
                </>
              )}
              {stage === 2 && (
                <>
                  Settle <Check size={16} />
                </>
              )}
              {stage === 3 && <>Settled</>}
            </button>
            <button
              onClick={reset}
              className="btn inline-flex items-center gap-2 px-3 py-2 rounded-full text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]"
            >
              <RotateCcw size={12} /> reset
            </button>
          </div>
        </div>

        <div className="md:col-span-7">
          <ChainGraph stage={stage} balances={balances} />
        </div>
      </div>
    </Chapter>
  );
}

function ChainGraph({ stage, balances }) {
  // SVG positions
  const nodes = {
    A: { x: 80, y: 150, name: "Alice" },
    B: { x: 290, y: 70, name: "Bob" },
    C: { x: 500, y: 150, name: "Charlie" },
  };

  return (
    <div className="rounded-lg deckle paper grain p-6">
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--ink-muted)]">
          The trust graph
        </div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--ink-muted)]">
          stage {stage} / 3
        </div>
      </div>

      <svg viewBox="0 0 580 280" className="w-full h-auto">
        {/* Background trust lines (always shown, faint) */}
        <line
          x1={nodes.A.x}
          y1={nodes.A.y}
          x2={nodes.B.x}
          y2={nodes.B.y}
          stroke="rgba(74, 53, 32, 0.25)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
        <line
          x1={nodes.B.x}
          y1={nodes.B.y}
          x2={nodes.C.x}
          y2={nodes.C.y}
          stroke="rgba(74, 53, 32, 0.25)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />

        {/* Active payment edges */}
        {stage >= 1 && (
          <PaymentEdge
            from={nodes.A}
            to={nodes.B}
            label="−€10"
            color="var(--burgundy)"
            settled={stage === 3}
          />
        )}
        {stage >= 2 && (
          <PaymentEdge
            from={nodes.B}
            to={nodes.C}
            label="−€10"
            color="var(--burgundy)"
            settled={stage === 3}
          />
        )}

        {/* Nodes */}
        {Object.entries(nodes).map(([k, n]) => (
          <PersonNode key={k} node={n} balance={balances[k]} active={stage > 0} />
        ))}
      </svg>

      <div className="mt-4 grid grid-cols-3 gap-3 text-center font-mono text-xs">
        <BalanceCell name="Alice" v={balances.A} />
        <BalanceCell name="Bob" v={balances.B} highlight={stage === 3} />
        <BalanceCell name="Charlie" v={balances.C} />
      </div>
      <div className="mt-3 text-xs italic text-[var(--ink-muted)]">
        {stage === 0 && "Three friends, two trust links. No transfers yet."}
        {stage === 1 && "Alice owes Bob €10. Bob's balance now favours him by €10."}
        {stage === 2 && "Bob settles the chain by recording a matching tally with Charlie. Bob is back to neutral."}
        {stage === 3 && "Done. The favour traveled across the chain — and Bob never moved any money of his own."}
      </div>
    </div>
  );
}

function PersonNode({ node, balance, hideBalance }) {
  const r = 36;
  const balanceText =
    balance === 0
      ? "€0"
      : balance > 0
      ? `+€${balance}`
      : `−€${Math.abs(balance)}`;
  return (
    <g>
      <circle
        cx={node.x}
        cy={node.y}
        r={r + 4}
        fill="none"
        stroke="rgba(74, 53, 32, 0.3)"
        strokeWidth="1"
        strokeDasharray="2 3"
      />
      <circle
        cx={node.x}
        cy={node.y}
        r={r}
        fill="var(--parchment-dark)"
        stroke="var(--ink)"
        strokeWidth="1.5"
      />
      <text
        x={node.x}
        y={hideBalance ? node.y + 5 : node.y - 4}
        textAnchor="middle"
        fontFamily="Fraunces"
        fontStyle="italic"
        fontSize="16"
        fill="var(--ink)"
      >
        {node.name}
      </text>
      {!hideBalance && (
        <text
          x={node.x}
          y={node.y + 12}
          textAnchor="middle"
          fontFamily="JetBrains Mono"
          fontSize="11"
          fill={
            balance < 0
              ? "var(--burgundy)"
              : balance > 0
              ? "var(--moss)"
              : "var(--ink-muted)"
          }
        >
          {balanceText}
        </text>
      )}
    </g>
  );
}

function PaymentEdge({ from, to, label, color, settled }) {
  // animated dashed line with arrow
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2 - 10;
  return (
    <g>
      <line
        x1={from.x + 30}
        y1={from.y}
        x2={to.x - 30}
        y2={to.y}
        stroke={color}
        strokeWidth="2.2"
        strokeDasharray="6 6"
        className={settled ? "" : "dashflow"}
        opacity={settled ? 0.7 : 1}
      />
      <text
        x={midX}
        y={midY}
        textAnchor="middle"
        fontFamily="JetBrains Mono"
        fontSize="11"
        fill={color}
      >
        {label}
      </text>
    </g>
  );
}

function BalanceCell({ name, v, highlight }) {
  return (
    <div
      className={`p-2 rounded ${
        highlight ? "bg-[var(--gold)]/30 ring-1 ring-[var(--gold)]" : ""
      }`}
    >
      <div className="text-[var(--ink-muted)] text-[10px] uppercase tracking-widest">
        {name}
      </div>
      <div
        className="text-base font-medium"
        style={{
          color:
            v < 0
              ? "var(--burgundy)"
              : v > 0
              ? "var(--moss)"
              : "var(--ink-muted)",
        }}
      >
        {v === 0 ? "€0" : v > 0 ? `+€${v}` : `−€${Math.abs(v)}`}
      </div>
    </div>
  );
}

/* -------------------------------------------------- */
/* CHAPTER 5 — Loop cancellation                      */
/* -------------------------------------------------- */
function ChapterLoops() {
  const [phase, setPhase] = useState(0);
  // 0: loop present  1: detected  2: cancelled

  return (
    <Chapter
      num="05"
      kicker="The magic of loops"
      title={
        <>
          When debts go in <em className="italic">a circle</em>, the network simply lets them go.
        </>
      }
      accent="moss"
    >
      <div className="grid md:grid-cols-12 gap-10">
        <div className="md:col-span-5 space-y-5 font-body text-lg text-[var(--ink-soft)] leading-relaxed">
          <p>
            Suppose Alice owes Bob €20. Bob owes Charlie €20. And Charlie, by
            coincidence, owes Alice €20. Each of them carries a debt — but
            taken together,{" "}
            <span className="text-[var(--ink)] font-semibold">they all cancel.</span>
          </p>
          <p>
            Tally watches for these loops automatically. When it spots one, the
            entries dissolve in unison across all three ledgers. Nobody pays;
            nobody is paid; the obligations evaporate.
          </p>
          <p className="text-[var(--ink-muted)] italic">
            In a community with rich trust links, much of the "debt" you see
            on day one will quietly vanish on day seven.
          </p>

          <div className="pt-4 flex flex-wrap gap-3">
            <button
              onClick={() => setPhase((p) => Math.min(p + 1, 2))}
              disabled={phase === 2}
              className={`btn inline-flex items-center gap-2 px-5 py-2.5 rounded-full font-display text-base ${
                phase === 2
                  ? "bg-[var(--parchment-dark)] text-[var(--ink-muted)] cursor-not-allowed"
                  : "cta-stamp text-[var(--parchment)]"
              }`}
            >
              {phase === 0 && (
                <>
                  Detect loops <Sparkles size={16} />
                </>
              )}
              {phase === 1 && (
                <>
                  Cancel them <Repeat size={16} />
                </>
              )}
              {phase === 2 && <>Loop dissolved</>}
            </button>
            <button
              onClick={() => setPhase(0)}
              className="btn inline-flex items-center gap-2 px-3 py-2 rounded-full text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]"
            >
              <RotateCcw size={12} /> reset
            </button>
          </div>
        </div>

        <div className="md:col-span-7">
          <LoopGraph phase={phase} />
        </div>
      </div>
    </Chapter>
  );
}

function LoopGraph({ phase }) {
  const cx = 290,
    cy = 150,
    r = 105;
  const angles = [-Math.PI / 2, Math.PI / 6, Math.PI - Math.PI / 6];
  const pts = angles.map((a) => ({
    x: cx + r * Math.cos(a),
    y: cy + r * Math.sin(a),
  }));
  const names = ["Alice", "Bob", "Charlie"];

  // Edges: 0->1, 1->2, 2->0 (each is a debt of 20)
  const edges = [
    { from: 0, to: 1, label: "owes €20" },
    { from: 1, to: 2, label: "owes €20" },
    { from: 2, to: 0, label: "owes €20" },
  ];

  return (
    <div className="rounded-lg deckle paper grain p-6">
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--ink-muted)]">
          The loop
        </div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--ink-muted)]">
          {phase === 0 && "before"}
          {phase === 1 && "loop detected"}
          {phase === 2 && "cleared"}
        </div>
      </div>

      <svg viewBox="0 0 580 300" className="w-full h-auto">
        {/* Outer ring glow when detected */}
        {phase === 1 && (
          <circle
            cx={cx}
            cy={cy}
            r={r + 30}
            fill="none"
            stroke="var(--gold)"
            strokeWidth="2"
            className="glow"
            opacity="0.6"
          />
        )}

        {/* Edges */}
        {edges.map((e, i) => {
          const A = pts[e.from];
          const B = pts[e.to];
          // Compute a curved arc
          const mx = (A.x + B.x) / 2;
          const my = (A.y + B.y) / 2;
          const dx = B.x - A.x;
          const dy = B.y - A.y;
          const len = Math.hypot(dx, dy);
          // outward perpendicular
          const ox = -dy / len;
          const oy = dx / len;
          const curve = 30;
          const cpx = mx + ox * curve;
          const cpy = my + oy * curve;

          // Place label outside the arc: opposite the control-point direction
          // (ox,oy points toward triangle centre, so negate to go outward)
          const lx = mx - ox * 44;
          const ly = my - oy * 44;

          const inLoopColor =
            phase === 1 ? "var(--gold)" : "var(--burgundy)";
          return (
            <g key={i} className={phase === 2 ? "fade-out" : ""}>
              <path
                d={`M ${A.x} ${A.y} Q ${cpx} ${cpy} ${B.x} ${B.y}`}
                fill="none"
                stroke={inLoopColor}
                strokeWidth={phase === 1 ? "2.6" : "2"}
                strokeDasharray="6 6"
                className={phase === 0 ? "dashflow" : ""}
                opacity={phase === 1 ? 0.95 : 0.8}
              />
              <text
                x={lx}
                y={ly + 4}
                textAnchor="middle"
                fontFamily="JetBrains Mono"
                fontSize="11"
                fill={inLoopColor}
              >
                {e.label}
              </text>
            </g>
          );
        })}

        {/* Nodes */}
        {pts.map((p, i) => (
          <PersonNode
            key={i}
            node={{ x: p.x, y: p.y, name: names[i] }}
            balance={0}
            hideBalance
          />
        ))}

        {phase === 2 && (
          <text
            x={cx}
            y={cy + 6}
            textAnchor="middle"
            fontFamily="Fraunces"
            fontStyle="italic"
            fontSize="22"
            fill="var(--moss)"
          >
            ∅ all settled
          </text>
        )}
      </svg>

      <div className="mt-3 text-xs italic text-[var(--ink-muted)]">
        {phase === 0 && "Three debts going in a single direction. Look familiar?"}
        {phase === 1 && "Tally finds the cycle. Each edge has a matching counter-claim somewhere along the loop."}
        {phase === 2 && "The loop dissolves on every device at once. Nobody moved a cent — yet everybody is square."}
      </div>
    </div>
  );
}

/* -------------------------------------------------- */
/* CHAPTER 6 — What stays, what doesn't               */
/* -------------------------------------------------- */
function ChapterPrivacy() {
  const items = [
    {
      icon: Lock,
      title: "Stays on your device",
      body: "Tallies are signed, encrypted, and stored locally. There is no central server keeping a copy.",
    },
    {
      icon: Globe,
      title: "Nostr-compatible identity",
      body: "Your identity is a key pair you control. Bring it from elsewhere, take it elsewhere.",
    },
    {
      icon: CircleDot,
      title: "Trust limits you set",
      body: "You decide how much risk to carry with each friend. The network respects your ceilings.",
    },
    {
      icon: Repeat,
      title: "Works offline",
      body: "Record a favour at a campfire with no signal. The two halves still match when you reconnect.",
    },
  ];

  return (
    <Chapter
      num="06"
      kicker="Properties"
      title={
        <>
          What's <em className="italic">guaranteed</em>, what's{" "}
          <em className="italic">never collected.</em>
        </>
      }
    >
      <div className="grid md:grid-cols-2 gap-5">
        {items.map((it, i) => {
          const Icon = it.icon;
          return (
            <div
              key={i}
              className="rounded-lg deckle paper grain p-6 hover:bg-[var(--parchment-dark)] transition-colors"
            >
              <Icon
                size={22}
                className="mb-3"
                style={{ color: "var(--burgundy)" }}
              />
              <h3 className="font-display text-2xl text-[var(--ink)] mb-2">
                {it.title}
              </h3>
              <p className="font-body text-base text-[var(--ink-soft)] leading-relaxed">
                {it.body}
              </p>
            </div>
          );
        })}
      </div>
    </Chapter>
  );
}

/* -------------------------------------------------- */
/* CHAPTER 7 — Quiz                                   */
/* -------------------------------------------------- */
const QUESTIONS = [
  {
    q: "Alice owes Bob €30. Bob owes Charlie €30. Charlie owes Alice €30. After Tally runs loop detection, what are the balances?",
    options: [
      "Everyone still owes €30.",
      "Only Alice is settled.",
      "All three balances become €0 — the loop dissolves.",
      "The €30 collects in the network as fees.",
    ],
    correct: 2,
    explain:
      "Each obligation has a matching counter-obligation along the loop, so the entire cycle cancels out across all three ledgers at once. No money moves.",
  },
  {
    q: "You don't know David. Bob does. Bob trusts David, and you trust Bob. Can you send David a favour through Tally?",
    options: [
      "No — you can only transact with direct friends.",
      "Yes — Tally routes the favour through Bob, who stays neutral.",
      "Only if you also add David as a friend first.",
      "Only with cash.",
    ],
    correct: 1,
    explain:
      "This is chained trust. You record one tally with Bob, Bob records one of equal value with David, and Bob's net balance is unchanged. The favour reaches David through your shared friend.",
  },
  {
    q: "What gets uploaded to a Tally server when you record a favour with Sam?",
    options: [
      "Your name, Sam's name, and the amount.",
      "An encrypted copy of the entry, just in case.",
      "Nothing — both halves live on your two devices.",
      "Only the amount, anonymously.",
    ],
    correct: 2,
    explain:
      "Tally is peer-to-peer. The two matching halves of the tally exist on the two phones involved — no server holds a copy. Like a real tally stick split between you.",
  },
  {
    q: "You and your neighbour want to track favours in 'home-cooked dinners' rather than euros. Possible?",
    options: [
      "No, only fiat currencies are supported.",
      "Yes — any unit you both agree on works.",
      "Only if you provide an exchange rate.",
      "Only for amounts under €10.",
    ],
    correct: 1,
    explain:
      "Tally is unit-agnostic. The two of you choose the denomination — euros, hours, meals, weeded rows — and the system simply tracks matching marks.",
  },
];

function ChapterQuiz() {
  const [answers, setAnswers] = useState({});
  const [revealed, setRevealed] = useState({});

  const select = (qi, oi) => {
    if (revealed[qi]) return;
    setAnswers((a) => ({ ...a, [qi]: oi }));
    setRevealed((r) => ({ ...r, [qi]: true }));
  };

  const score = Object.entries(answers).filter(
    ([qi, oi]) => QUESTIONS[qi].correct === oi
  ).length;
  const allDone = Object.keys(revealed).length === QUESTIONS.length;

  return (
    <Chapter
      num="07"
      kicker="Test the idea"
      title={
        <>
          Four scenarios. <em className="italic">What would Tally do?</em>
        </>
      }
      accent="gold"
    >
      <div className="space-y-8">
        {QUESTIONS.map((Q, qi) => (
          <QuestionCard
            key={qi}
            qi={qi}
            Q={Q}
            chosen={answers[qi]}
            revealed={revealed[qi]}
            onPick={(oi) => select(qi, oi)}
          />
        ))}
      </div>

      {allDone && (
        <div className="mt-10 rounded-lg deckle paper grain p-7 ink-in">
          <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--ink-muted)] mb-2">
            Your tally
          </div>
          <div className="flex items-baseline gap-3 mb-3">
            <span className="serif-num text-6xl text-[var(--burgundy)]">
              {score}
            </span>
            <span className="font-display text-2xl text-[var(--ink)]">
              / {QUESTIONS.length}
            </span>
          </div>
          <p className="font-body text-lg text-[var(--ink-soft)] italic">
            {score === QUESTIONS.length &&
              "Mastered. You'd make a fine notary on the network."}
            {score === 3 && "Almost there — just one knot left to untie."}
            {score === 2 && "Halfway. Re-read the chapters and try again."}
            {score < 2 && "Worth another pass. The model rewards a slow read."}
          </p>
        </div>
      )}
    </Chapter>
  );
}

function QuestionCard({ qi, Q, chosen, revealed, onPick }) {
  return (
    <div className="rounded-lg deckle paper grain p-6 md:p-7">
      <div className="flex items-baseline gap-3 mb-4">
        <span className="serif-num text-2xl text-[var(--gold)]">
          0{qi + 1}.
        </span>
        <h3 className="font-display text-xl md:text-2xl text-[var(--ink)] leading-snug">
          {Q.q}
        </h3>
      </div>

      <div className="space-y-2">
        {Q.options.map((opt, oi) => {
          const isCorrect = oi === Q.correct;
          const isChosen = chosen === oi;
          let cls =
            "btn w-full text-left p-3 rounded-md border font-body text-base transition-all";
          if (!revealed) {
            cls +=
              " border-[var(--ink-muted)]/30 hover:border-[var(--ink)] hover:bg-[var(--parchment-dark)] text-[var(--ink-soft)]";
          } else if (isCorrect) {
            cls +=
              " border-[var(--moss)] bg-[var(--moss)]/10 text-[var(--ink)]";
          } else if (isChosen) {
            cls +=
              " border-[var(--burgundy)] bg-[var(--burgundy)]/10 text-[var(--ink-soft)]";
          } else {
            cls += " border-[var(--ink-muted)]/20 text-[var(--ink-muted)]";
          }
          return (
            <button
              key={oi}
              onClick={() => onPick(oi)}
              disabled={revealed}
              className={cls}
            >
              <span className="inline-flex items-center gap-3">
                {revealed && isCorrect && (
                  <Check size={16} className="text-[var(--moss)]" />
                )}
                {revealed && !isCorrect && isChosen && (
                  <X size={16} className="text-[var(--burgundy)]" />
                )}
                {!revealed && (
                  <span className="font-mono text-xs text-[var(--ink-muted)]">
                    {String.fromCharCode(65 + oi)}.
                  </span>
                )}
                <span>{opt}</span>
              </span>
            </button>
          );
        })}
      </div>

      {revealed && (
        <div className="mt-4 pl-3 border-l-2 border-[var(--gold)] ink-in">
          <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--ink-muted)] mb-1">
            Why
          </div>
          <p className="font-body italic text-[var(--ink-soft)]">{Q.explain}</p>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------- */
/* CHAPTER 8 — CTA                                    */
/* -------------------------------------------------- */
function CTA() {
  return (
    <section className="paper grain relative">
      <div className="max-w-6xl mx-auto px-6 py-24 md:py-32 text-center">
        <div className="font-mono uppercase tracking-[0.25em] text-xs text-[var(--ink-muted)] mb-6">
          08 · plant the first root
        </div>
        <h2 className="font-display font-light text-5xl md:text-7xl text-[var(--ink)] leading-[0.95] tracking-tight max-w-3xl mx-auto">
          Now go put a <em className="italic underline-wavy">notch</em> on the stick.
        </h2>
        <p className="font-body text-xl text-[var(--ink-soft)] mt-7 max-w-2xl mx-auto leading-snug">
          Tally is in early access — open it in your browser, no install,
          no sign-up, just you and the people whose favours you trust.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <a
            href="https://iou-ui.up.railway.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="btn cta-stamp text-[var(--parchment)] font-display text-lg px-8 py-4 rounded-full inline-flex items-center gap-3"
          >
            Try Tally <ArrowRight size={18} />
          </a>
          <a
            href="https://github.com/jussiry/IOU"
            target="_blank"
            rel="noopener noreferrer"
            className="btn font-display text-lg px-6 py-4 rounded-full text-[var(--ink)] hover:bg-[var(--parchment-dark)]"
          >
            Read the source →
          </a>
        </div>

        <div className="mt-20 flex items-center justify-center gap-6 text-xs font-mono text-[var(--ink-muted)]">
          <span>peer-to-peer</span>
          <div className="w-8 h-px bg-[var(--ink-muted)] opacity-40" />
          <span>open source</span>
          <div className="w-8 h-px bg-[var(--ink-muted)] opacity-40" />
          <span>your data, your device</span>
        </div>
      </div>

      <footer className="border-t border-[var(--ink-muted)]/15 py-8 px-6 text-center font-mono text-[10px] uppercase tracking-widest text-[var(--ink-muted)]">
        © 2026 Tally · community money, honestly · interactive primer made by claude
      </footer>
    </section>
  );
}

/* -------------------------------------------------- */
/* APP                                                */
/* -------------------------------------------------- */
export default function App() {
  return (
    <div className="paper text-[var(--ink)] min-h-screen">
      <style>{STYLES}</style>
      <Hero />
      <ChapterAncient />
      <ChapterRecord />
      <ChapterUnits />
      <ChapterChain />
      <ChapterLoops />
      <ChapterPrivacy />
      <ChapterQuiz />
      <CTA />
    </div>
  );
}
