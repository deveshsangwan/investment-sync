export function LogoAttribution() {
  if (!process.env.NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY?.startsWith("pk_"))
    return null;

  return (
    <a
      href="https://logo.dev"
      className="text-xs text-muted-foreground hover:text-foreground"
    >
      Logos provided by Logo.dev
    </a>
  );
}
