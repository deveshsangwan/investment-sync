import { isDataConfigured } from "@investment-sync/api";
import type { Metadata } from "next";
import { HoldingsClient } from "./holdings-client";

export const metadata: Metadata = {
  title: "Holdings",
  description: "Search and filter current and exited household positions.",
};

export default function HoldingsPage() {
  return <HoldingsClient isDataConfigured={isDataConfigured()} />;
}
