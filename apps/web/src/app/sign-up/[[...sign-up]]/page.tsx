import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="mx-auto grid min-h-screen max-w-7xl place-items-center px-4 py-10 sm:px-6 lg:px-8">
      <SignUp />
    </main>
  );
}
