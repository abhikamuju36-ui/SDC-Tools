"use client";

import { createContext, useActionState, useContext, useRef } from "react";
import { changedFormData, countChanged } from "@/lib/dirty-form";
import type { SaveQuotedResult } from "@/lib/quoted-actions";

// The Projects grid's <form>. Two jobs, both of which need a client component:
//
// 1. It holds useActionState, so the Save button can report what the action
//    actually did — counts on success, the message on failure. A server
//    component's `<form action={serverAction}>` can never see the return value,
//    which is why a validation error used to have to reach the user by throwing
//    into the route's error boundary, discarding the grid and every unsaved edit
//    in it.
// 2. It submits ONLY the controls whose value differs from the server's — see
//    dirty-form.ts. A native submit posts the entire matrix (~1,100 fields for 50
//    jobs × 13 sections) on every save, however little was edited.
//
// The grid itself stays a SERVER component, passed through as `children`, so none
// of those thousands of cells ship to the browser as client JS. This file renders
// a <form> and nothing else.
//
// Note the trade this makes: submission now runs through onSubmit rather than the
// form's `action`, so saving requires JavaScript. That's not a new dependency in
// practice — the grid's cell editing, menus and toolbar are all client components
// already — but it is the reason `action` is deliberately absent below.

type SaveCtxValue = { result: SaveQuotedResult | null; pending: boolean };

// Defaults let the Save button render in isolation (tests, stories) without a
// provider rather than crashing.
const SaveCtx = createContext<SaveCtxValue>({ result: null, pending: false });

export function useSaveState(): SaveCtxValue {
  return useContext(SaveCtx);
}

export function QuotedSaveForm({
  action,
  className,
  children,
}: {
  action: (prev: SaveQuotedResult | null, formData: FormData) => Promise<SaveQuotedResult>;
  className?: string;
  children: React.ReactNode;
}) {
  const [result, dispatch, pending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    // Owning the submit outright: React would otherwise serialize the whole form
    // for us, which is precisely the cost being avoided.
    e.preventDefault();
    if (pending) return; // ignore a double-click on Save mid-flight
    const form = formRef.current;
    if (!form) return;
    // Deliberately still dispatched when nothing changed: the action reports "No
    // changes to save", which is real information — silently doing nothing is
    // indistinguishable from a broken button, which is how this page's save came
    // to be doubted in the first place.
    const changed = countChanged(form);
    console.debug(`[Projects] saving ${changed} changed field${changed === 1 ? "" : "s"} of ${form.elements.length}`);
    dispatch(changedFormData(form));
  }

  return (
    <SaveCtx.Provider value={{ result, pending }}>
      <form ref={formRef} onSubmit={onSubmit} className={className}>
        {children}
      </form>
    </SaveCtx.Provider>
  );
}
