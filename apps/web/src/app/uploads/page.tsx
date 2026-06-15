import { isDataConfigured } from "@investment-sync/api";
import { UploadsClient } from "./uploads-client";

export default function UploadsPage() {
  return <UploadsClient isDataConfigured={isDataConfigured()} />;
}
