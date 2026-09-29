"use client";

import { createContext, Fragment, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

type Profile = { name: string; mobile: string; user_type: string; is_admin: boolean };
type Identity = { user: User | null; profile: Profile | null; loading: boolean };
const IdentityContext = createContext<Identity>({ user: null, profile: null, loading: true });

export async function getCurrentUserId() {
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user?.id ?? null;
}

export async function getCurrentIdentity(): Promise<Identity> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { user: null, profile: null, loading: false };
  const { data: profile } = await supabase.from("profiles")
    .select("name,mobile,user_type,is_admin").eq("id", data.user.id).single();
  return { user: data.user, profile: profile as Profile | null, loading: false };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [identity, setIdentity] = useState<Identity>({ user: null, profile: null, loading: true });
  useEffect(() => {
    let active = true;
    let generation = 0;
    const refresh = async () => {
      const ticket = ++generation;
      const next = await getCurrentIdentity().catch(() => ({ user: null, profile: null, loading: false }));
      if (active && ticket === generation) setIdentity(next);
    };
    void refresh();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        generation++;
        setIdentity({ user: null, profile: null, loading: false });
      } else {
        generation++;
        // Do not await a Supabase request inside its auth lock callback.
        setTimeout(() => { if (active) void refresh(); }, 0);
      }
    });
    return () => { active = false; generation++; subscription.unsubscribe(); };
  }, []);
  return <IdentityContext.Provider value={identity}>
    <Fragment key={identity.user?.id ?? "guest"}>{children}</Fragment>
  </IdentityContext.Provider>;
}

export function useIdentity() { return useContext(IdentityContext); }
