export const fixtureInput = {
  project: {
    name: "Pipeline",
    description: "Ship the VisBoard MVP.",
    status: "active" as const,
    slug: "pipeline",
  },
  workspace: {
    slug: "acme",
  },
  apiBaseUrl: "http://localhost:8080",
  users: [
    {
      id: "user_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      display_name: "Alex Chen",
    },
  ],
  agents: [
    {
      id: "agent_01ARZ3NDEKTSV4RRFFQ69G5FBB",
      name: "Reviewer",
      scopes: ["read", "write:checklists"],
    },
  ],
  notes: [
    {
      slug: "purpose",
      title: "Purpose",
      body: "# Purpose\nShip VisBoard as the shared context board for agents and humans.",
    },
    {
      slug: "agents.local.md",
      title: "Local overrides",
      body: "Always run smoke tests before release.",
    },
  ],
  checklists: [
    {
      id: "chk_01ARZ3NDEKTSV4RRFFQ69G5FCC",
      title: "Launch",
      items: [
        {
          id: "item_01ARZ3NDEKTSV4RRFFQ69G5FDD",
          text: "Ship API",
          done: false,
          assignee_type: "agent" as const,
          assignee_id: "reviewer",
        },
        {
          id: "item_01ARZ3NDEKTSV4RRFFQ69G5FEE",
          text: "Write spec",
          done: true,
        },
      ],
    },
  ],
  files: [
    {
      id: "file_01ARZ3NDEKTSV4RRFFQ69G5FFF",
      name: "data.json",
      mime_type: "application/json",
      size_bytes: 42,
    },
  ],
  localOverrides: "Always run smoke tests before release.",
};
