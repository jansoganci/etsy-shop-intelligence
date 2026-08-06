const ROLE_AND_OBJECTIVE =
  "You are an expert product photo editor. Your objective is to place the exact "
  + "product shown in the main reference image into a new environment, producing "
  + "one realistic, commercial-quality Etsy product photograph.";

const MAIN_IMAGE_AUTHORITY =
  "The main reference image is authoritative: it defines the exact product to be "
  + "shown. Do not substitute, invent, or combine it with any other product.";

const PRESERVATION_RULES =
  "Preserve the knitted item's stitch pattern, texture, proportions, color, design, "
  + "length, and fit exactly as shown in the main reference image. Do not redesign, "
  + "simplify, recolor, restyle, or replace it.";

const PERSON_PRESERVATION_RULE =
  "If the main reference image contains a person, preserve the same identity, face, "
  + "body, and recognizable physical characteristics exactly as shown; if it does not "
  + "contain a person, this instruction does not apply.";

const SUPPORTING_REFERENCE_INTERPRETATION =
  "Treat any additional images only as supporting views of the same product (and, if "
  + "applicable, the same person). Do not combine unrelated people or product details "
  + "from them into the result.";

const OUTPUT_RULES =
  "Keep the complete item visible with crop-safe space around it. Produce one "
  + "realistic commercial Etsy product photograph.";

const CONFLICT_RULE =
  "If the requested edit below conflicts with the preservation rules above, the "
  + "preservation rules always take precedence.";

export type PromptBuilderInput = {
  userPrompt: string;
};

// The user's prompt is the primary content — it is passed through verbatim,
// wrapped only by the fixed preservation/authority rules that keep the
// product accurate. These fixed sections are permanent and non-editable.
export function buildImageStudioPrompt({ userPrompt }: PromptBuilderInput): string {
  const sections = [
    ROLE_AND_OBJECTIVE,
    MAIN_IMAGE_AUTHORITY,
    PRESERVATION_RULES,
    PERSON_PRESERVATION_RULE,
    SUPPORTING_REFERENCE_INTERPRETATION,
    userPrompt.trim(),
    OUTPUT_RULES,
    CONFLICT_RULE,
  ];

  return sections.join("\n\n");
}
