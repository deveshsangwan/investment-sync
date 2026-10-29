import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const AuthContext = createContext<{
  subject: string | null;
  signIn: (subject: string | null) => void;
}>({ subject: null, signIn: () => undefined });

export function TestIdentityProvider({ children }: { children: ReactNode }) {
  const [subject, signIn] = useState<string | null>(null);

  return (
    <AuthContext.Provider value={{ subject, signIn }}>
      <nav aria-label="Test identities">
        {["e2e_owner", "e2e_viewer", "e2e_other"].map((identity) => (
          <button key={identity} onClick={() => signIn(identity)}>
            {identity}
          </button>
        ))}
        <button onClick={() => signIn(null)}>Sign out</button>
      </nav>
      {subject ? children : <p>Sign in with a local test identity</p>}
    </AuthContext.Provider>
  );
}

// This alias exists only in the Vite test fixture, never in Next's build.
// Convex still verifies the signed JWT against the local issuer's JWKS.
export function useAuth() {
  const { subject } = useContext(AuthContext);
  const getToken = useCallback(async () => {
    if (!subject) return null;

    const response = await fetch(`http://127.0.0.1:3220/token/${subject}`);
    if (!response.ok) throw new Error("Local test issuer unavailable");

    return response.text();
  }, [subject]);

  return useMemo(
    () => ({
      isLoaded: true,
      isSignedIn: subject !== null,
      userId: subject,
      sessionId: subject ? `session_${subject}` : null,
      orgId: null,
      orgRole: null,
      getToken,
    }),
    [subject, getToken],
  );
}
