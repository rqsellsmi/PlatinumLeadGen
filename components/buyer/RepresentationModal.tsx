'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

/** The representation answer the modal returns to its caller. */
export type RepresentationAnswer =
  | { kind: 'none' }
  | { kind: 'other_brokerage' }
  | { kind: 'our_agent'; claimedAgentId?: number | null; claimedAgentName?: string | null };

const OPEN_EVENT = 'open-buyer-representation';

let resolver: ((a: RepresentationAnswer | null) => void) | null = null;

/**
 * Ask the buyer whether they already work with an agent. Resolves with the
 * answer, or null if they dismiss it. Called once before a buyer's first
 * lead-creating action (the server signals `needsRepresentation`).
 */
export function askRepresentation(): Promise<RepresentationAnswer | null> {
  return new Promise((resolve) => {
    resolver = resolve;
    window.dispatchEvent(new CustomEvent(OPEN_EVENT));
  });
}

interface AgentOpt {
  id: number;
  name: string;
}

/**
 * Two-step representation question (mounted once, globally):
 *   1. Are you already working with a real estate agent?
 *   2. If yes → is it one of our RE/MAX Platinum agents? (pick from the roster,
 *      "I don't see them" → type a name, or "not with RE/MAX Platinum").
 */
export default function RepresentationModal() {
  const [mounted, setMounted] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<1 | 2>(1);
  const [agents, setAgents] = React.useState<AgentOpt[] | null>(null);
  const [query, setQuery] = React.useState('');
  const [typedName, setTypedName] = React.useState('');
  const [showType, setShowType] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    const onOpen = () => {
      setStep(1);
      setQuery('');
      setTypedName('');
      setShowType(false);
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  // Load the roster when advancing to step 2.
  React.useEffect(() => {
    if (step !== 2 || agents !== null) return;
    fetch('/api/buyer/agents')
      .then((r) => r.json())
      .then((d) => setAgents(d.agents ?? []))
      .catch(() => setAgents([]));
  }, [step, agents]);

  function finish(answer: RepresentationAnswer | null) {
    setOpen(false);
    resolver?.(answer);
    resolver = null;
  }

  if (!mounted || !open) return null;

  const filtered = (agents ?? []).filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()));

  return createPortal(
    <div className="fixed inset-0 z-[96] flex items-center justify-center bg-black/50 p-4" onClick={() => finish(null)}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h2 className="text-xl font-extrabold text-charcoal">
            {step === 1 ? 'One quick question' : 'Is your agent with RE/MAX Platinum?'}
          </h2>
          <button type="button" aria-label="Close" onClick={() => finish(null)} className="text-2xl leading-none text-mute hover:text-charcoal">
            ×
          </button>
        </div>

        {step === 1 ? (
          <>
            <p className="mt-1 text-sm text-mute">Are you currently working with a real estate agent?</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => finish({ kind: 'none' })}
                className="rounded-pill border border-line bg-white px-5 py-3 text-sm font-bold text-charcoal hover:border-platinum-blue"
              >
                No, not yet
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="rounded-pill bg-platinum-blue px-5 py-3 text-sm font-bold text-white hover:bg-platinum-blue/90"
              >
                Yes, I am
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-mute">Choose your agent so we route you correctly.</p>

            {!showType ? (
              <>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search agents…"
                  className="mt-4 w-full rounded-md border border-line px-3 py-2.5 text-sm"
                />
                <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-line">
                  {agents === null ? (
                    <p className="px-3 py-4 text-sm text-mute">Loading…</p>
                  ) : filtered.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-mute">No matches.</p>
                  ) : (
                    filtered.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => finish({ kind: 'our_agent', claimedAgentId: a.id, claimedAgentName: a.name })}
                        className="block w-full px-3 py-2.5 text-left text-sm text-charcoal hover:bg-cream"
                      >
                        {a.name}
                      </button>
                    ))
                  )}
                </div>
                <div className="mt-4 flex flex-col gap-2 text-sm">
                  <button type="button" onClick={() => setShowType(true)} className="font-semibold text-platinum-blue hover:underline">
                    I don&rsquo;t see my agent
                  </button>
                  <button
                    type="button"
                    onClick={() => finish({ kind: 'other_brokerage' })}
                    className="text-left font-medium text-mute hover:text-charcoal"
                  >
                    My agent isn&rsquo;t with RE/MAX Platinum
                  </button>
                </div>
              </>
            ) : (
              <>
                <input
                  type="text"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  placeholder="Your agent's name"
                  className="mt-4 w-full rounded-md border border-line px-3 py-2.5 text-sm"
                  autoFocus
                />
                <div className="mt-4 flex items-center justify-between">
                  <button type="button" onClick={() => setShowType(false)} className="text-sm font-medium text-mute hover:text-charcoal">
                    ← Back
                  </button>
                  <button
                    type="button"
                    disabled={!typedName.trim()}
                    onClick={() => finish({ kind: 'our_agent', claimedAgentName: typedName.trim() })}
                    className="rounded-pill bg-platinum-blue px-5 py-2.5 text-sm font-bold text-white hover:bg-platinum-blue/90 disabled:opacity-60"
                  >
                    Continue
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
