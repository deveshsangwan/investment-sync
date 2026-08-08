import type { NpsDetails } from "@investment-sync/importers";
import { FileSpreadsheet, ReceiptText } from "lucide-react";
import { EmptyState, SectionCard } from "@/components/portfolio-ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatCurrency,
  formatDate,
  formatPercent,
  formatQuantity,
  npsSchemeLabel,
} from "@/lib/format";

export function NpsDetailsSections({
  details,
  currency,
  totalValue,
}: {
  details: NpsDetails;
  currency: string;
  totalValue: number;
}) {
  return (
    <>
      <SectionCard
        title="NPS allocation"
        description="Current Tier I allocation across the schemes reported by the NPS portal."
        className="mt-4"
      >
        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scheme</TableHead>
                <TableHead>Fund manager</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Weight</TableHead>
                <TableHead>Units</TableHead>
                <TableHead>NAV</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {details.schemes.map((scheme) => (
                <TableRow key={scheme.code}>
                  <TableCell className="font-medium">
                    {npsSchemeLabel(scheme.code)}
                  </TableCell>
                  <TableCell>{scheme.fundManager ?? "N/A"}</TableCell>
                  <TableCell className="number font-semibold">
                    {formatCurrency(scheme.currentValue, currency)}
                  </TableCell>
                  <TableCell className="number">
                    {formatPercent(
                      totalValue > 0
                        ? (scheme.currentValue / totalValue) * 100
                        : 0,
                    )}
                  </TableCell>
                  <TableCell className="number">
                    {formatQuantity(scheme.units)}
                  </TableCell>
                  <TableCell className="number">
                    {formatCurrency(scheme.nav, currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="grid gap-3 md:hidden">
          {details.schemes.map((scheme) => (
            <div
              key={scheme.code}
              className="rounded-lg border border-border/60 bg-muted/30 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold">{npsSchemeLabel(scheme.code)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {scheme.fundManager ?? scheme.sourceName}
                  </p>
                </div>
                <p className="number font-semibold">
                  {formatCurrency(scheme.currentValue, currency)}
                </p>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {formatPercent(
                  totalValue > 0 ? (scheme.currentValue / totalValue) * 100 : 0,
                )}
                {" / "}
                {formatQuantity(scheme.units)} units / NAV{" "}
                {formatCurrency(scheme.nav, currency)}
              </p>
            </div>
          ))}
        </div>
      </SectionCard>

      <section className="mt-4 grid gap-4 xl:grid-cols-2">
        <SectionCard
          title="Contribution / redemption breakdown"
          description="Employee and employer amounts included in this statement."
        >
          {details.contributionEvents.length === 0 ? (
            <EmptyState
              icon={FileSpreadsheet}
              title="No contribution or redemption rows"
              description="This statement did not include contribution or redemption details for the selected period."
            />
          ) : (
            <div className="divide-y">
              {details.contributionEvents.map((event, index) => (
                <div
                  key={`${event.date}-${index}`}
                  className="grid grid-cols-2 gap-3 py-3 sm:grid-cols-4"
                >
                  <div>
                    <p className="text-xs capitalize text-muted-foreground">
                      {event.type}
                    </p>
                    <p className="mt-1 text-sm font-medium">
                      {formatDate(event.date)}
                    </p>
                  </div>
                  <NpsAmount
                    label="Employee"
                    value={event.employeeAmount}
                    currency={currency}
                  />
                  <NpsAmount
                    label="Employer"
                    value={event.employerAmount}
                    currency={currency}
                  />
                  <NpsAmount
                    label="Total"
                    value={event.totalAmount}
                    currency={currency}
                  />
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Statement activity"
          description="Activity included in this statement. It may not represent complete account history."
        >
          {details.activities.length === 0 ? (
            <EmptyState
              icon={ReceiptText}
              title="No statement activity"
              description="No scheme activity rows were included in this statement."
            />
          ) : (
            <div className="divide-y">
              {details.activities.map((activity, index) => (
                <div
                  key={`${activity.schemeCode}-${activity.date}-${index}`}
                  className="flex items-start justify-between gap-4 py-3"
                >
                  <div>
                    <p className="font-medium">{activity.description}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {npsSchemeLabel(activity.schemeCode)} /{" "}
                      {formatDate(activity.date)}
                      {activity.units !== undefined
                        ? ` / ${formatQuantity(activity.units)} units`
                        : ""}
                    </p>
                  </div>
                  <p className="number shrink-0 font-semibold">
                    {activity.amount === undefined
                      ? "N/A"
                      : formatCurrency(activity.amount, currency)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </section>
    </>
  );
}

function NpsAmount({
  label,
  value,
  currency,
}: {
  label: string;
  value: number;
  currency: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="number mt-1 text-sm font-semibold">
        {formatCurrency(value, currency)}
      </p>
    </div>
  );
}
