export type TemplateCategory = "Legal" | "Sales" | "HR";

export type Template = {
  id: number;
  initial: string;
  name: string;
  category: TemplateCategory;
  updated: string;
  uses: string;
  color: string;
  fileDataUrl?: string;
  mimeType?: string;
  detectedText?: string;
  detectedPlaceholders?: string[];
  preview: {
    headline: string;
    sections: Array<{ title: string; lines: string[] }>;
  };
};

const today = new Date().toLocaleDateString("en-US", { month: 'short', day: 'numeric', year: 'numeric' });

const OFFER_LETTER_CONTENT = `<strong>Subject: Employment offer from [SENDER_COMPANY]</strong>

Dear <strong>[CANDIDATE_NAME]</strong>,

We are pleased to offer you the position of <strong>[DESIGNATION]</strong> at [SENDER_COMPANY].

Your annual <strong>cost to company</strong> is ₹ <strong>[ANNUAL_COST]</strong> ([COST_IN_WORDS]). The break down of your gross salary and information specific to employee benefits can be found in Annexure A.

We would like you to start work on <strong>[JOINING_DATE]</strong> from the base location, [WORK_LOCATION].

We are confident that you will find this offer exciting and I, on behalf of [SENDER_COMPANY], assure you of a very rewarding career in our organization.

<strong>Sincerely,</strong>

[SENDER_NAME]
[SENDER_DESIGNATION], [SENDER_COMPANY]

[SIGNATURE]`;

export const templates: Template[] = [
  {
    id: 1,
    initial: "O",
    name: "Employment Offer Letter",
    category: "HR",
    updated: today,
    uses: "0 uses",
    color: "bg-blue-50 text-blue-600",
    preview: {
      headline: "Employment Offer Letter",
      sections: [
        {
          title: "Position",
          lines: [
            "Title: [DESIGNATION]",
            "Company: [SENDER_COMPANY]",
            "Start Date: [JOINING_DATE]",
            "Location: [WORK_LOCATION]"
          ]
        },
        {
          title: "Compensation",
          lines: [
            "Annual Cost: ₹ [ANNUAL_COST]",
            "In Words: [COST_IN_WORDS]"
          ]
        },
        {
          title: "Sender Info",
          lines: [
            "Name: [SENDER_NAME]",
            "Designation: [SENDER_DESIGNATION]"
          ]
        },
      ]
    }
  }
];

// Export the raw template content for use in the template flow
export const OFFER_LETTER_TEMPLATE = OFFER_LETTER_CONTENT;
