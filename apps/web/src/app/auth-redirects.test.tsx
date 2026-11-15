// @vitest-environment jsdom
import type { ComponentProps } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SignIn, SignUp } from "@clerk/nextjs";
import SignInPage from "./sign-in/[[...sign-in]]/page";
import SignUpPage from "./sign-up/[[...sign-up]]/page";

vi.mock("@clerk/nextjs", () => ({
  SignIn: vi.fn<(_props: ComponentProps<typeof SignIn>) => null>(() => null),
  SignUp: vi.fn<(_props: ComponentProps<typeof SignUp>) => null>(() => null),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("lets Clerk return to the requested page after sign-in or switching to sign-up", () => {
  render(<SignInPage />);

  const props = vi.mocked(SignIn).mock.calls[0]?.[0];

  expect(props).toBeDefined();
  expect(props?.forceRedirectUrl).toBeUndefined();
  expect(props?.signUpForceRedirectUrl).toBeUndefined();
  expect(props?.fallbackRedirectUrl).toBe("/dashboard");
  expect(props?.signUpFallbackRedirectUrl).toBe("/dashboard");
});

it("lets Clerk return to the requested page after sign-up or switching to sign-in", () => {
  render(<SignUpPage />);

  const props = vi.mocked(SignUp).mock.calls[0]?.[0];

  expect(props).toBeDefined();
  expect(props?.forceRedirectUrl).toBeUndefined();
  expect(props?.signInForceRedirectUrl).toBeUndefined();
  expect(props?.fallbackRedirectUrl).toBe("/dashboard");
  expect(props?.signInFallbackRedirectUrl).toBe("/dashboard");
});
