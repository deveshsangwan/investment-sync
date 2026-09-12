"use client";

import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { useId } from "react";

export function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  const id = useId();

  return (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Select.Root value={value} onValueChange={onChange}>
        <Select.Trigger id={id} className="select-trigger">
          <span className="truncate">
            <Select.Value />
          </span>
          <Select.Icon asChild>
            <ChevronDown
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            position="popper"
            sideOffset={6}
            collisionPadding={12}
            className="select-content"
          >
            <Select.ScrollUpButton className="select-scroll">
              <ChevronUp className="size-4" />
            </Select.ScrollUpButton>
            <Select.Viewport className="p-1">
              {options.map(([optionValue, optionLabel]) => (
                <Select.Item
                  key={optionValue}
                  value={optionValue}
                  className="select-option"
                >
                  <Select.ItemText>{optionLabel}</Select.ItemText>
                  <Select.ItemIndicator className="ml-auto flex shrink-0">
                    <Check className="size-4" aria-hidden="true" />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
            <Select.ScrollDownButton className="select-scroll">
              <ChevronDown className="size-4" />
            </Select.ScrollDownButton>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
