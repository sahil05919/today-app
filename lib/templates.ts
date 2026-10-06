import type { TemplateId } from "./types";

export interface TemplateStep {
  title: string;
  estimateMin: number;
}
export interface Template {
  id: TemplateId;
  label: string;
  emoji: string;
  steps: TemplateStep[];
}

export const TEMPLATES: Record<TemplateId, Template> = {
  project: {
    id: "project",
    label: "Project",
    emoji: "🧩",
    steps: [
      { title: "Define the goal and what “done” looks like", estimateMin: 15 },
      { title: "Break it into a few milestones", estimateMin: 20 },
      { title: "Do the first small chunk", estimateMin: 45 },
      { title: "Check progress and adjust", estimateMin: 15 },
      { title: "Finish and share it", estimateMin: 30 },
    ],
  },
  trip: {
    id: "trip",
    label: "Trip",
    emoji: "🧳",
    steps: [
      { title: "Pick dates and destination", estimateMin: 20 },
      { title: "Book transport", estimateMin: 30 },
      { title: "Book somewhere to stay", estimateMin: 30 },
      { title: "Sketch a rough itinerary", estimateMin: 30 },
      { title: "Sort passport, tickets and insurance", estimateMin: 15 },
      { title: "Pack", estimateMin: 30 },
    ],
  },
  job: {
    id: "job",
    label: "Job application",
    emoji: "💼",
    steps: [
      { title: "Read the job spec and note key points", estimateMin: 15 },
      { title: "Tailor your CV", estimateMin: 40 },
      { title: "Write the cover letter", estimateMin: 45 },
      { title: "Proofread everything", estimateMin: 15 },
      { title: "Submit the application", estimateMin: 10 },
      { title: "Set a follow-up reminder", estimateMin: 5 },
    ],
  },
  admin: {
    id: "admin",
    label: "Admin / paperwork",
    emoji: "📄",
    steps: [
      { title: "Gather the documents you need", estimateMin: 15 },
      { title: "Find the form or login", estimateMin: 10 },
      { title: "Fill it in", estimateMin: 30 },
      { title: "Submit or send it", estimateMin: 10 },
      { title: "File a copy of the confirmation", estimateMin: 5 },
    ],
  },
  event: {
    id: "event",
    label: "Event / occasion",
    emoji: "🎉",
    steps: [
      { title: "Confirm date, time and place", estimateMin: 15 },
      { title: "Tell or invite people", estimateMin: 15 },
      { title: "Plan food, gifts and details", estimateMin: 30 },
      { title: "Book or buy what's needed", estimateMin: 30 },
      { title: "Final check the day before", estimateMin: 10 },
    ],
  },
};

export const TEMPLATE_LIST = Object.values(TEMPLATES);
