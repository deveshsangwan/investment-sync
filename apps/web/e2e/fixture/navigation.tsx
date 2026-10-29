import { useSyncExternalStore, type AnchorHTMLAttributes } from "react";

function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}

export function usePathname() {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

export default function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      onClick={(event) => {
        event.preventDefault();
        if (!props.href) return;

        window.history.pushState({}, "", props.href);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }}
    />
  );
}
