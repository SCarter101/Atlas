# Atlas Prototype Specification

## 1. Product Summary

Atlas is a desktop-first writing application for solo novelists who want to develop, draft, revise, and polish long-form fiction with the help of specialized LLM-powered writing agents. The application is designed for future published authors, especially writers working in thriller, crime/suspense, science fiction, and fantasy.

Atlas should feel like a serious writing app with integrated AI collaborators, not a generic AI chat workspace. The manuscript remains the center of the experience, while the Codex, outline, scene metadata, revision comments, agents, tools, and skills support the writer's creative process.

The long-term product direction is to compete with tools such as Sudowrite, Novelcrafter, and Scrivener, while offering a more personalized, author-centered workflow.

## 2. Prototype Goal

The first prototype should demonstrate the user interface and core workflow before implementing functional AI behavior.

### Prototype Type

- Standalone web application
- Desktop-first design
- Clickable mockup
- UI flow first
- LLM orchestration visualization second
- No functional agent loops or tool execution required in the first prototype phase
- Populated sample project as the default demonstration state

### Minimum Impressive Demo

The prototype should allow a user to move through the core Atlas experience:

1. Create or open a writing project.
2. View and edit a starter Codex.
3. Navigate book, part, chapter, and scene structure.
4. Work inside a manuscript editor.
5. Open sidebar AI agents.
6. Highlight text and route it to an agent.
7. View comments, tracked changes, or structured reports.
8. See a dashboard showing project progress, Codex completeness, unresolved issues, and drafting status.
9. Inspect an agent-routing visualization showing how an agent accesses model settings, the Codex, manuscript context, tools, and skills.
10. Open the command palette to navigate or invoke an agent.
11. Experience the guided Story Foundations onboarding flow.
12. View a static story timeline that connects scenes, characters, and plot events.

### Phase 1 Acceptance Criteria

- A first-time reviewer should understand within one minute that Atlas is a manuscript-centered writing environment with a living Codex and specialized agents, not a generic chatbot.
- The default opening state should be a populated, partially drafted thriller project with a rich Codex, an open Story Editor report, and visible tracked changes.
- The manuscript, Codex, outline, and agent relationship should be legible without explanation.
- Core prototype interactions should be clickable even when the underlying AI, retrieval, import, and export services are simulated.
- Advanced controls should not compete with the primary writing workflow in the default state.

### Experience and Design Direction

Atlas should evoke "The Writer's Study": warm, literary, quietly confident, and focused on sustained creative work.

Visual direction:

- Use warm paper tones such as `#FAF8F5` for light surfaces and deep warm charcoal such as `#1E1B18` for dark surfaces; avoid pure white and pure black.
- Present the manuscript as the page on the writer's desk, with a readable measure of approximately 65 to 70 characters, subtle page edges or elevation, and a comfortable top margin.
- Treat navigation and agent panels as the desk around the page rather than decorative cards.
- Use one restrained brand accent, preferably deep ink blue or forest green. Avoid purple-led palettes and decorative gradients associated with generic AI products.
- Use semantic colors consistently: amber for tentative facts and warnings, red for contradictions and errors, and green for canon or resolved states.
- Use a manuscript serif such as Literata, Source Serif 4, or Charter, with two or three curated editor font choices. Use a humanist sans serif for interface text and tabular data.
- Default manuscript text should be approximately 18 to 20 pixels with a line height of at least 1.6.

Interaction direction:

- Use subtle 150 to 250 millisecond ease-out transitions for panels and state changes.
- Show quiet, non-blocking agent activity outside the manuscript page; do not place loading spinners inside manuscript prose.
- Use restrained completion feedback for finishing a scene, chapter, session goal, or daily goal.
- Give each agent a stable role icon and restrained accent tint, without mascots. Suggested metaphors include a nib for Generator, compass for Story Editor, loupe for Line Editor, quotation marks for Dialogue Editor, and globe for World Builder.
- Each agent card should display its assigned model, current status, and whether tools or skills are being used.
- Include Paper, Night, and Typewriter focus themes. Paper and Night should be represented in Phase 1; the full theme system may be implemented in Phase 4.

Accessibility baseline:

- Meet WCAG AA color contrast for essential text and controls.
- Support complete keyboard navigation for the primary workflow.
- Honor the operating system's reduced-motion preference.
- Allow scalable editor type without breaking the workspace layout.
- Remain compatible with operating-system dictation and assistive input.

## 3. Target User

### Primary User

Solo novelists building publishable long-form fiction.

### User Assumptions

- The user is more likely a plotter than a pantser.
- The user wants structured support for story planning, continuity, character arcs, scene purpose, and revision.
- The user may write from scratch or import an existing manuscript.
- The user wants a human-machine creative partnership, not a system that treats AI output as separate from the writing process.

## 4. Core Writing Workflow

Atlas should guide the writer through a structured but flexible novel-writing process.

### New Project Workflow

1. The writer creates a new project.
2. Atlas launches a guided, conversational Story Foundations setup that builds the starter Codex one question at a time.
3. Story Foundations should show progress, allow individual questions to be skipped, and encourage the writer to answer briefly now and deepen entries later.
4. The writer should be able to choose a roughly 10-minute fast path or a thorough setup expected to take 45 minutes or more.
5. The Codex should visibly grow as answers are supplied.
6. The starter Codex must include:
   - Protagonist character bible
   - World interview answers
   - Short story synopsis
7. The writer creates book, part, chapter, and scene structure.
8. Each scene receives structured metadata and an outline.
9. The writer drafts the scene manually or uses Generator assistance.
10. The writer may send the scene to Dialogue Editor or World Builder for targeted review.
11. Completed scenes accumulate into chapters.
12. Completed chapters become context feeders for later chapters.
13. After a major section, act, or manuscript is complete, Story Editor analyzes structural issues.
14. After structural revisions are resolved, Line Editor performs language-level cleanup.
15. The finished manuscript can be exported in multiple formats.

### Existing Manuscript Workflow

Atlas should support importing an existing manuscript and extracting candidate Codex entries, including:

- Characters
- Locations
- Timeline details
- Themes
- Plot threads
- Objects
- Factions
- World rules
- Research references

Extracted entries should be proposed to the writer for approval before becoming canonical Codex content.

## 5. Project Structure

Atlas projects should be stored locally in a project folder organized for both human readability and LLM retrieval.

### Manuscript Hierarchy

- Project
- Book
- Part
- Chapter
- Scene

Chapters may contain multiple scenes. Each scene should exist as an independently addressable workspace item.

### Scene Metadata

Each scene should support structured metadata inspired by craft frameworks such as Lisa Cron's story-development approach and Jennie Nash's book-blueprint methodology.

Scene metadata should use progressive disclosure rather than presenting every field at once.

Tier 1 - always visible:

- Scene title and chapter
- POV character
- Location
- Time or date
- Scene purpose

Tier 2 - Story Craft, expanded on demand:

- Character desire
- External goal
- Internal conflict and opposition
- Stakes
- Turning point
- Outcome
- Emotional shift
- Revealed information

Tier 3 - Continuity and Threads, expanded on demand:

- Timeline placement
- Continuity notes
- Setup and payoff links
- Foreshadowing
- Theme and motif tags
- Relevant Codex entries

In Phase 4, agents may propose metadata based on the current draft, but the writer must approve changes.

## 6. Codex / Knowledgebase

The Codex is the central story knowledgebase. Its purpose is to maintain consistency, preserve author intent, and provide relevant context to Atlas agents.

### Minimum Starter Codex

The initial Codex must include:

- Protagonist character bible
- World interview answers
- Short story synopsis

The starter Codex should be created through Story Foundations, a guided interview that asks one question at a time, supports fast and thorough paths, allows skipped questions, and shows new entries appearing as the writer responds.

### Codex Entry Types

Atlas should support typed entries where appropriate, without forcing unnecessary structure.

Recommended entry types:

- Character
- Location
- Faction
- Object
- Event
- World rule
- Timeline item
- Relationship
- Theme
- Motif
- Research note
- Historical reference
- Scene note
- Private author note

### Codex Fact Status

Codex facts should default to `canon`, but the writer may manually change their status.

Supported statuses:

- Canon
- Tentative
- Deprecated
- Contradicted

### Codex Requirements

- Human-created entries should be primary.
- AI may augment entries with writer approval.
- AI-proposed Codex additions must never become canon automatically.
- Codex entries should support relationships between people, places, events, objects, and story rules.
- Atlas should detect potential Codex contradictions.
- Codex entries should be versioned over time.
- Codex facts should link to manuscript passages where they appear.
- The Codex should support spoiler-aware progressive reveal logic.
- Some entries or notes should be marked as private author notes.
- Private author notes should have a clear visual distinction.
- Some entries may be marked as local-model-only.
- World rules may be locked manually so Generator cannot violate them.

## 7. AI Writing Agents

Atlas includes multiple specialized LLM agents. OpenRouter provides access to commercial and hosted open-source models, while local models may be provided through LM Studio. Agent planning, memory, tool use, permissions, and execution are managed by Atlas through a model-neutral agent runtime rather than by OpenRouter.

User-facing agent names should be concise and readable. Preserve the original names as internal aliases for prompts, configuration, and migration compatibility:

- Generator: `Generator`
- Story Editor: `Dev-Editor`
- Line Editor: `Line-Editor`
- Dialogue Editor: `Dialoguer`
- World Builder: `World-Builder`

### 7.1 Generator

Generator is the primary drafting agent. It can create baseline text, fill in missing portions of a scene, continue existing prose, expand beats, and provide alternative versions.

Generator should use:

- Scene outline
- Scene metadata
- Relevant Codex entries
- Previous chapter summaries
- Prior prose style samples
- Chapter accumulation context
- Progressive reveal constraints

Generator capabilities:

- Generate full scenes.
- Generate partial continuations.
- Expand scene beats into prose.
- Produce alternative versions.
- Analyze and imitate the writer's existing prose style.
- Ask clarifying questions when the outline is vague.
- Support controls for tone, pacing, POV depth, dialogue density, exposition level, violence level, heat level, and literary style.
- Include rationale, notes, warnings, and suggested next steps when appropriate.
- Propose new Codex facts, but require user approval before adding them.
- Select approved tools or skills when they are more efficient or reliable than generating the result directly.

### 7.2 Story Editor (Dev-Editor)

Story Editor is system-prompted as an industry developmental editor. It focuses on story structure, logic, pacing, genre expectations, and manuscript-level problems.

Primary operating level:

- Act
- Full manuscript

It should still provide precise references to:

- Chapter
- Scene
- Beat
- Codex entry
- Plot thread

Story Editor should detect:

- Plot holes
- Structural problems
- Weak stakes
- Missing causality
- Pacing issues
- Sagging middle
- Weak chapter hooks
- Low-conflict scenes
- Repeated beats
- Cliches
- Logic gaps
- Genre expectation failures
- Unresolved promises
- Broken setups and payoffs
- Character arc problems
- Timeline issues
- POV inconsistency
- Continuity problems

Story Editor output should include:

- Structured editorial report
- Detailed notes
- Severity scores
- Revision plan
- Suggested rewrites or edits
- Status tracking for each issue

Issue statuses:

- Open
- Accepted
- Rejected
- In progress
- Fixed

### 7.3 Line Editor (Line-Editor)

Line Editor is system-prompted as a line editor and copy editor. It focuses on clarity, natural prose flow, spelling, grammar, style, consistency, and humanizing synthetically generated text.

Line Editor should:

- Suggest tracked changes rather than silently editing manuscript text.
- Preserve the author's voice.
- Offer a full rewrite only when a passage remains unclear.
- Support configurable editing intensity.
- Flag AI-sounding prose separately from grammar and style issues.
- Support house style rules.
- Detect repeated sentence structures.
- Detect filler phrases.
- Detect filter words.
- Detect adverb overuse.
- Detect overwritten prose.
- Detect naming inconsistencies.
- Detect spelling and grammar errors.

Editing intensity options:

- Light polish
- Standard copyedit
- Heavy rewrite
- Custom

### 7.4 Dialogue Editor (Dialoguer)

Dialogue Editor focuses on dialogue quality, character voice, tension, subtext, and scene-level conversational dynamics.

Dialogue Editor should use character voice profiles from the Codex.

Voice profile fields may include:

- Vocabulary
- Rhythm
- Education level
- Humor style
- Emotional guardedness
- Accent or dialect notes
- Verbal tics
- Taboo topics
- Speech directness
- Formality level
- Favorite phrases
- Avoided phrases
- Power dynamics

Dialogue Editor should:

- Compare a character's dialogue against prior dialogue.
- Detect when multiple characters sound too similar.
- Review dialogue lines, action beats, and subtext.
- Suggest alternate dialogue options at different tension levels.
- Evaluate whether each line advances conflict, reveals character, or changes the scene.
- Recommend improvements when dialogue is inert.
- Preserve immersion and scene tension.

### 7.5 World Builder (World-Builder)

World Builder uses the world repository inside the Codex as its primary knowledgebase. It can also use web-sourced information to enrich the Codex when appropriate.

World Builder should begin with an interview process.

Minimum world interview topics:

- What kind of world grounds the story?
- What does the environment look, sound, smell, taste, and feel like?
- How does this world affect the characters?
- What pressures does the world place on the plot?
- What facts must remain consistent?
- What world rules are flexible, tentative, or locked?

World Builder should support genre-specific templates:

- Fantasy kingdom
- Sci-fi colony
- Space opera setting
- Crime city
- Suspense/thriller environment
- Historical setting
- Contemporary town
- Custom

World Builder should:

- Separate invented world facts from researched real-world facts.
- Include citations and source links for internet research.
- Store research notes in the Codex with reliability ratings.
- Support Wikipedia or web-search enrichment where useful.
- Propose maps, timelines, family trees, political systems, religions, economies, and cultural norms when necessary.
- Require writer approval before adding proposed material to the Codex.
- Use approved research, citation, timeline, and Codex-management tools when available.

## 8. Agent, LLM, and Model Architecture

Atlas should use a model-neutral agent runtime and route supported remote model calls through OpenRouter. Agent behavior must not depend on provider-specific reasoning formats or tool APIs. The same Atlas agent and capability definitions should work with OpenAI, Anthropic, Google, other OpenRouter-supported models, and compatible local models.

### Agent Runtime

Each writing agent should operate through a bounded, goal-oriented loop inspired by ReAct or a comparable observe-plan-act pattern:

1. Receive the writer's goal, selected manuscript scope, and applicable constraints.
2. Retrieve only the necessary Codex, manuscript, outline, and project context.
3. Plan the next action and determine whether an approved skill or executable tool is useful.
4. Request authorization when the action requires a sensitive capability that is not already approved for the session.
5. Execute the action, observe the structured result, and update working state.
6. Repeat within configured step, token, time, and cost limits.
7. Return a writer-facing result, citations or provenance where applicable, and proposed manuscript or Codex changes for approval.

Atlas should expose a concise action trace showing the context categories, tools, skills, permissions, and results involved. It must not require or display a model's private chain-of-thought. Agents should stop and ask the writer when requirements are ambiguous, permissions are denied, confidence is too low, or configured limits are reached.

### Model-Neutral Capability Protocol

- Atlas should define one internal schema for agent goals, tool calls, skill invocation, structured results, errors, permissions, and provenance.
- Provider adapters should translate between this schema and each model provider's tool-calling format.
- MCP-compatible adapters should allow Atlas to discover and invoke external MCP tools and resources without making the internal runtime dependent on MCP.
- Tools and skills should declare inputs, outputs, supported scopes, side effects, permission requirements, compatibility, version, and expected cost characteristics.
- Agents may discover all capabilities available to their project and user scope, but may invoke only capabilities compatible with the selected model and allowed by current policy.

### Supported Model Sources

- Anthropic models
- OpenAI models
- Google Gemini models
- Other OpenRouter-supported commercial models
- Local LM Studio models

### Model Configuration

The writer should be able to:

- Bring their own OpenRouter API key.
- Manually select models based on their subscription plans.
- Configure model choice per agent.
- Edit system prompts as an advanced-user feature.
- Use local LM Studio models for privacy-sensitive projects.
- Set fallback behavior.

### Fallback Behavior

If an external model call fails, Atlas should fall back to local LM Studio models when configured. Before continuing an in-progress agent run, Atlas must verify that the fallback model supports the required context size, structured output, and tool-calling capabilities. Otherwise, the run should pause with a clear recovery option.

### Token and Cost Tracking

Atlas should track:

- Token usage by project
- Token usage by chapter
- Token usage by agent
- Token usage attributable to tool or skill orchestration
- Token usage by model
- Estimated cost by project
- Estimated cost by agent
- Estimated cost by model

Before any potentially expensive operation, Atlas should show a plain-language pre-flight estimate based on the selected model and context size. For example: "A full-manuscript Story Editor pass is estimated to cost $X to $Y." The writer must be able to confirm, change models, or cancel.

### Agent Routing Visualization

The prototype should include a visual routing tab showing how an agent request flows through the runtime.

The visualization may resemble a node-based workflow diagram similar to ComfyUI or Dify.

Example nodes:

- Selected agent
- User selection or highlighted text
- Agent goal and constraints
- Agent prompt and bounded loop
- Tool and skill discovery
- Permission check
- Model selection
- OpenRouter
- LM Studio fallback
- Codex retrieval
- Manuscript context
- Chapter summaries
- Web search
- Structured tool result
- Response format
- Writer approval step

### Tool and Skill Library

Atlas should maintain a shared capability library that every writing agent can search when needed. The library should distinguish:

- Tools: executable, schema-defined capabilities for deterministic or externally connected work, such as searching, parsing, calculating, transforming, validating, exporting, or updating approved application data.
- Skills: reusable, versioned procedures containing prompts, instructions, examples, decision rules, and optional tool dependencies for tasks that still require model judgment.

The library should support two clearly labeled scopes:

- Global library: reusable capabilities available across the writer's Atlas projects.
- Project library: story- or workflow-specific capabilities available only within the current project.

Project capabilities may depend on global capabilities. Capability identifiers must be namespaced and versioned so a project skill cannot silently replace a global skill with the same name. Agents should search project-specific capabilities first when the task is project-specific, then consider compatible global capabilities.

Each tool or skill manifest should include:

- Name, description, type, scope, owner, and version
- Input and output schema
- Required context and dependencies
- Compatible agent roles and model capabilities
- Side effects and permission category
- Local-only or external-provider restrictions
- Estimated token, time, and monetary cost characteristics
- Test or validation status
- Creation source and change history
- Enable, disable, deprecate, and rollback state

### Capability Creation and Maturation

During Atlas application development, simple tools and skills may be generated and installed automatically to seed and test the library. Generated executable tools must still pass schema validation, automated checks, and sandboxed execution before use.

In production:

- Writers may create or edit tools and skills directly, start from an Atlas template, or ask an agent to prepare a draft for review.
- Agents may identify repeated processes and recommend a new capability or an improvement to an existing one.
- The agent should choose an executable tool for stable, deterministic processes and a prompt-based skill for judgment-heavy processes. A capability may combine both when that is more efficient.
- Agents may create a reviewable draft, manifest, tests, and expected savings, but may not install, enable, replace, or broaden a capability without explicit writer approval.
- The recommendation should explain the repeated process, proposed scope, required permissions, dependencies, expected benefit, and estimated token or context savings.
- Approval applies to both newly generated capabilities and modifications to installed capabilities.
- Installed versions should remain auditable, reversible, exportable, and portable across compatible model providers.
- Writers may promote a proven project capability to the global library or fork a global capability into a project-specific version through an explicit review action.

Capability maturation should optimize for the goal rather than novelty. Atlas should prefer compact reusable procedures, deterministic transformations, selective retrieval, cached structured results, and summarized intermediate state when these reduce token burn without weakening story context or increasing drift.

### Agent Limits and Efficiency

Each agent run should have configurable limits for:

- Maximum model turns and tool calls
- Token and monetary budget
- Maximum elapsed time
- Manuscript and Codex scope
- Allowed capability categories
- Retry and fallback behavior

The runtime should detect repeated or circular actions, stop runaway loops, and preserve enough structured state to resume a paused run without replaying unnecessary context. Usage reporting should separate model inference usage, retrieval context, skill instructions, and tool results so Atlas can measure whether a capability actually improves efficiency.

## 9. Memory, Context, and Retrieval

Atlas must manage context carefully to reduce drift, redundancy, and inconsistency.

### Retrieval Strategy

Atlas should use embeddings and vector search for Codex and manuscript retrieval.

Retrieval should prioritize:

1. Previous chapter summaries
2. Current scene outline
3. Relevant Codex entries
4. Relevant character voice profiles
5. Locked world rules
6. Recent manuscript excerpts
7. Full text excerpts only when necessary

### Rolling Summaries

Atlas should maintain rolling summaries of chapters to reduce context size.

Recommended summaries:

- Chapter summary
- Scene summary
- Character arc summary
- Timeline summary
- World-state summary
- Open setups and promises
- Payoff status

### Context Inspection

The writer should be able to inspect what context was sent to the LLM.

Context inspection should show:

- Included Codex entries
- Included chapter summaries
- Included manuscript excerpts
- Included scene metadata
- Included model settings
- Excluded but potentially relevant items
- Context warnings
- Agent run limits and remaining budget
- Tools and skills selected during the run
- Permission decisions and structured action results

### Context Warnings

Atlas should warn the writer when context may be incomplete.

Warnings should include:

- What seems missing
- Why it matters
- A suggested fix

## 10. User Interface Requirements

The prototype should focus on a clear, desktop-first writing workspace.

### Essential Screens

- Project dashboard
- Story Foundations onboarding
- Manuscript editor
- Codex panel
- Outline panel
- AI agent sidebar
- Tool and Skill Library
- Agent activity and permission review
- Comments and revisions panel
- Command palette
- Story timeline
- Agent routing visualization
- Settings
- Export panel

### Main Workspace Layout

Recommended desktop layout:

- Left sidebar: project navigation, outline, Codex quick access
- Center: manuscript editor
- Right sidebar: AI agents, comments, tracked changes, context inspection
- Top bar: project controls, model status, export, command palette, distraction-free mode
- Bottom/status area: word count, scene status, token estimate, save state

### Progressive Disclosure and Advanced Mode

Atlas should follow the rule: "Nothing appears until the manuscript needs it."

New projects should open with the editor, left navigation, and one collapsed agent rail. Scene metadata beyond Tier 1, fact-status controls, agent routing, prompt editing, and multiple drafts should remain hidden until invoked.

An Advanced Mode toggle should expose:

- Editable system prompts
- Per-agent model selection
- Multiple draft management
- Detailed context inspection
- Routing and token diagnostics

Advanced Mode must not change manuscript content or project data; it changes only which controls are visible.

### Command Palette

`Cmd+K` on macOS and `Ctrl+K` on Windows and Linux should open a searchable command palette. It should support:

- Jumping to scenes, chapters, and Codex entries
- Invoking an agent on the current selection or scene
- Toggling focus mode and themes
- Searching the manuscript
- Opening common project actions

### Agent Access

Writing agents should appear primarily in the right sidebar. Tools and skills should normally remain behind the agent experience and appear only when the writer opens an action trace, capability detail, permission request, or Advanced Mode.

Agents should also be callable inline through commands, such as:

- Send selected text to Story Editor
- Send selected text to Line Editor
- Send selected dialogue to Dialogue Editor
- Continue with Generator
- Check world consistency
- Propose Codex update

### Agent Response Presentation

Response format depends on the tool:

- Generator: replacement text, inserted text, or tracked changes
- Line Editor: tracked changes
- Story Editor: structured report
- World Builder: comments, proposed Codex updates, or tracked changes
- Dialogue Editor: comments, alternate lines, or tracked changes

### Universal AI Suggestion Contract

Every agent suggestion must:

- Be visually distinct from writer-authored manuscript text.
- Be attributed with the agent's stable icon and accent tint.
- Offer the same primary actions: Accept, Reject, and Refine.
- Remain reversible after acceptance through undo and snapshot history.
- Provide a follow-up instruction field when the writer chooses Refine.

This contract applies to prose insertions, tracked changes, editorial findings, dialogue alternatives, metadata proposals, and Codex additions.

When an agent uses a tool or skill, the suggestion should also provide a compact provenance link to the capability name, version, and relevant result. Detailed execution information belongs in the action trace rather than in the manuscript.

Phase 4 should add keyboard-first review controls, including `J` and `K` for next and previous suggestion, `A` to accept, `R` to reject, and batch acceptance by issue category.

### Dashboard Hierarchy and Momentum

The dashboard should organize information in this emotional order:

1. Momentum: current word count, optional streak or writing history, session goal, and a "Where you left off" resume card.
2. Status: drafting stage and progress by chapter or act.
3. Next steps: unresolved editorial findings and continuity issues framed as actionable work rather than failure states.

Writing history and streaks should be optional and collapsible. Phase 1 should mock up the dashboard and resume card; Phase 3 should implement the underlying session data and heat map.

### Distraction-Free Mode

Distraction-free mode is a first-class workspace state.

- The manuscript page remains visible.
- Navigation, toolbars, sidebars, dashboard information, and nonessential status elements leave the screen.
- Word count may appear on hover or keyboard focus.
- A subtle `Esc` hint explains how to leave the mode.
- Assistant suggestions requested during focus mode should queue silently and appear after the writer exits.

### Empty States

Every empty panel should teach its purpose through one concise sentence and offer one clear next action. Empty states should never present a menu of competing setup tasks.

Examples include creating the first character, outlining the first scene, linking a Codex fact, or beginning Story Foundations.

### Autosave Trust Signals

The workspace should display a clear save state such as "All changes saved - 2:14 PM" and provide a nearby entry point to snapshot history. Saving, syncing, and agent processing must use distinct status language.

### Required UI Features

- Highlight text and send it to an agent.
- Compare generated versions side-by-side.
- Enable multiple drafts only as an optional advanced feature.
- Support distraction-free writing mode.
- Show manuscript progress.
- Show unresolved issues.
- Show Codex completeness.
- Show drafting status.
- Display private author notes distinctly.
- Provide approval controls for AI-suggested Codex changes.
- Provide universal Accept, Reject, and Refine controls for AI suggestions.
- Support complete keyboard navigation and visible focus states.
- Honor reduced-motion and scalable-text preferences.
- Keep primary writing controls usable with operating-system dictation.
- Show the active agent's run limits, pause or cancel controls, and permission state without exposing private model reasoning.
- Allow the writer to inspect and revoke session-scoped capability approvals.

## 11. Novel-Writing Features

Atlas should support writers who plan deeply before and during drafting.

### Outline Frameworks

Atlas should support structured outlining systems, including:

- Three-act structure
- Save the Cat
- Hero's Journey
- Mystery clue grid
- Thriller escalation map
- Romance beats, in a future phase
- Custom structures

### Story Tracking

Atlas should track:

- Character arcs
- Promises
- Setups
- Payoffs
- Clues
- Reveals
- Foreshadowing
- Timelines
- POV consistency
- Head-hopping
- Theme recurrence
- Motifs
- Genre expectations
- Chapter hooks
- Scene turns
- Conflict level

### Continuity Support

Timeline tracking should help prevent continuity errors involving:

- Age
- Travel time
- Dates
- Injuries
- Seasons
- Historical events
- Series continuity

### Visual Story Tools

Atlas should translate story structure into visual, manuscript-linked views:

- Timeline view connecting scenes, story events, dates, and Codex facts
- Plot-thread board showing setups, clues, promises, and payoffs
- Character presence map across chapters and scenes
- Conflict or tension curve across the manuscript

Phase 1 should include one static timeline mockup using the sample project. Functional visual tools belong in Phases 3 and 4.

### Writing Craft Reference Layer

In Phase 4, Story Editor findings should link to concise in-app craft explainers for concepts such as hooks, scene turns, causality, stakes, setup and payoff, point of view, and pacing. These references should clarify a finding without turning the interface into a writing course.

### Read Aloud and Writing Sprints

Phase 4 should include:

- Text-to-speech playback with sentence-level highlighting.
- Focus sprints with 15, 25, and 45 minute presets.
- A quiet sprint summary showing elapsed time and words written.

## 12. Data and Storage

The prototype should assume local project storage.

### Local Project Folder

Project data should be stored in a local folder that is readable by the writer and accessible to Atlas retrieval systems.

Recommended conceptual structure:

```text
atlas-project/
  project.json
  manuscript/
    book-01/
      part-01/
        chapter-001/
          scene-001.md
          scene-001.meta.json
  codex/
    characters/
    world/
    timeline/
    research/
    private-notes/
  summaries/
    chapters/
    scenes/
    arcs/
  revisions/
  capabilities/
    skills/
    tools/
  agent-runs/
  exports/
  settings/
```

Global tools and skills should be stored in a separate Atlas user-library location so they are not duplicated into every project. Project manifests should reference compatible global capability identifiers and versions. Project-specific capabilities should remain exportable with the project.

### Export Formats

Atlas should support export to:

- Markdown
- DOCX
- PDF
- EPUB
- Plain text

### Codex Export

Codex data should export to:

- JSON
- Markdown
- Compressed/summarized series bible
- Typeset Series Bible export to PDF and EPUB in Phase 5

### Autosave and Backup

Atlas should support:

- Autosave
- Manual backups
- Project snapshots
- Recovery from interrupted sessions
- Session snapshot comparison and diffing in Phase 3

Full manuscript audit logs are not required for Phase 1. Phase 3 must retain agent action traces, permission decisions, and tool or skill lifecycle history because they are required for safety, debugging, and rollback.

## 13. Privacy and Authorization

Atlas should include privacy controls because unpublished manuscripts may be sent to commercial LLM providers.

### Required Privacy Features

- Notify the writer before sending manuscript content to an external provider.
- Require manual authorization before cloud model use.
- Allow Codex entries or chapters to be marked local-model-only.
- Warn the writer when using commercial cloud models with unpublished manuscript content.
- Store API keys in a backend vault rather than raw local files.
- Require authorization before sensitive tool execution, including web access, filesystem writes outside normal project operations, external APIs, manuscript-wide changes, or other declared side effects.
- Allow the writer to approve an identical repeated authorization for the current session. A session approval must be limited to the named capability, action type, data scope, and destination or provider.
- Session approvals must expire automatically when the session ends and remain visible and revocable during the session.
- A broader action, changed destination, expanded manuscript scope, or different capability version must trigger a new authorization request.
- Denying permission should pause or redirect the agent safely rather than causing silent fallback to another sensitive capability.
- Generated executable tools should run in a restricted sandbox with least-privilege access.

## 14. Agent, Prompt, Tool, and Skill Configuration

Advanced users should be able to inspect agent definitions, edit prompts, and manage installed tools and skills.

### Prompt Configuration Requirements

- Each agent should have a curated default system prompt and role definition.
- Prompts should be editable in advanced settings.
- Prompt changes should be reversible.
- Prompt versions should be labeled.
- Tool prompts should indicate required context sources.
- Tool prompts should define expected output format.

### Capability Management Requirements

- Browse global and project capabilities separately or together with clear scope labels.
- Search and filter by agent role, capability type, permission category, provider compatibility, and status.
- Inspect manifests, dependencies, versions, validation results, usage history, and estimated savings.
- Review agent-generated capability recommendations and compare proposed changes with the installed version.
- Create capabilities directly or from templates, and promote or fork them between project and global scopes.
- Approve, reject, refine, install, disable, deprecate, roll back, import, and export capabilities.
- Test draft capabilities against sample or copied project data before installation.
- Prevent agents from altering approval policy, permission categories, sandbox boundaries, or their own installation authority.

## 15. Prototype Phases

### Phase 1: Clickable UI Prototype

Goal: Demonstrate the core Atlas writing experience.

Included:

- "Writer's Study" design language with Paper and Night presentations
- Populated, partially drafted thriller sample project
- Project dashboard with momentum-first hierarchy and resume card
- Guided Story Foundations onboarding mockup
- Manuscript editor mockup
- Codex panel mockup
- Outline panel mockup
- Tiered scene metadata
- AI agent sidebar with role icons, accent tints, model assignment, and status
- Comments and revisions panel
- Universal Accept, Reject, and Refine suggestion pattern
- Command palette mockup
- Designed empty states
- Distraction-free mode mockup with queued agent suggestions
- Static story timeline mockup
- Autosave trust signal and snapshot-history entry point
- Accessibility baseline, keyboard navigation, and reduced-motion states
- Export panel mockup
- Agent routing visualization mockup

Not included:

- Functional LLM calls
- Functional OpenRouter integration
- Functional vector search
- Real manuscript import
- Real exports

### Phase 2: Agent Orchestration Architecture Prototype

Goal: Demonstrate the model-neutral agent architecture, capability library, permission flow, and provider routing without delivering functional capability creation or maturation.

Included:

- Agent runtime and bounded ReAct-style loop visualization
- Model-neutral goal, tool-call, result, error, provenance, and permission schemas
- OpenRouter and LM Studio routing configuration mockups
- Per-agent model selection
- LM Studio fallback configuration
- Token and cost estimates
- Plain-language cost pre-flight for expensive operations
- Simulated agent runs and tool or skill calls
- Read-only sample Tool and Skill Library with global and project scopes
- Sample tool and skill manifests, dependency views, and compatibility labels
- MCP-compatible adapter architecture
- Sensitive-action permission request and session-approval flow
- Agent run limit, pause, cancel, and recovery states
- Context inspection panel
- Prompt editor
- Writer approval step for proposed Codex changes

Not included:

- Functional autonomous agent loops
- Functional tool execution
- Functional tool or skill generation, installation, or maturation
- Production MCP connectivity

### Phase 3: Codex, Retrieval, and Agent Runtime Prototype

Goal: Make the Codex useful as a retrieval-backed story memory system and deliver the first functional, governed agent and capability runtime.

Included:

- Codex CRUD
- Entry relationships
- Fact statuses
- Version history
- Spoiler-aware reveal logic
- Embeddings/vector search
- Rolling chapter summaries
- Context warnings
- Manuscript passage links
- Session goals, writing history, and optional heat map data
- Session snapshot comparison and diffing
- Functional story timeline foundation
- Functional bounded agent loop with turn, token, time, cost, and scope limits
- Basic tool and skill registry with global and project scopes
- Model-neutral provider adapters and initial functional MCP-compatible adapter
- Capability discovery, compatibility filtering, and structured invocation
- Sandboxed executable tool runtime
- Sensitive-action permissions with narrowly scoped session approval
- Development-mode automatic generation and installation for simple seed capabilities
- Production-mode recommendation, draft, review, explicit approval, installation, versioning, rollback, and deprecation workflow
- Agent detection of repeated processes and recommendations for tools, skills, or combined capabilities
- Capability tests, validation status, dependencies, provenance, and usage metrics
- Efficiency reporting for token use, retrieved context, cached results, and estimated savings

### Phase 4: Drafting and Revision Tools

Goal: Enable meaningful assisted drafting and editing.

Included:

- Generator drafting
- Dialogue Editor review
- World Builder interview and suggestions
- Story Editor structured reports and craft reference links
- Line Editor tracked changes
- Side-by-side version comparison
- Revision status tracking
- Agent-proposed scene metadata with writer approval
- Keyboard-first suggestion review and batch actions
- Read-aloud with sentence highlighting
- Writing sprints and sprint summaries
- Complete Paper, Night, and Typewriter focus themes
- Plot-thread board, character presence map, and conflict/tension curve
- Production-ready agent use of approved tools and skills across all writing roles
- Capability recommendations based on repeated real writing workflows

### Phase 5: Import, Export, and Production Hardening

Goal: Make Atlas viable for real long-form writing projects.

Included:

- Manuscript import
- Codex extraction from imported manuscript
- Export to Markdown, DOCX, PDF, EPUB, and plain text
- Typeset Series Bible export to PDF and EPUB
- Autosave and backup
- Project snapshots
- Performance optimization
- Robust local storage
- Error handling
- Privacy authorization flows

### Post-Phase 5 Consideration

Support beta-reader annotation import from formats such as DOCX comments. Atlas should preserve attribution and source location, then offer to synthesize recurring feedback into Story Editor issues without replacing the original annotations.

## 16. Key Risks

### Risk 1: Context Limits

Atlas must avoid sending too much irrelevant context or too little essential context.

Mitigation:

- Rolling summaries
- Vector retrieval
- Context inspection
- Prioritized context selection
- Warnings when context appears incomplete

### Risk 2: Hallucinated Canon

AI agents may invent story facts that conflict with the Codex.

Mitigation:

- Approval required for Codex changes
- Fact status labels
- Locked world rules
- Contradiction detection
- Manuscript-to-Codex links
- Progressive reveal logic

### Risk 3: UX Complexity

Atlas has many powerful features that could overwhelm writers.

Mitigation:

- Manuscript-first interface
- Sidebar agents
- Progressive disclosure and an explicit Advanced Mode
- Tiered scene metadata
- Universal AI Suggestion Contract
- Default Codex fact status of canon
- Multiple drafts hidden behind activation
- Momentum-first dashboards and resume cues
- Designed, single-action empty states
- Focused distraction-free mode
- Tool-specific response formats

### Risk 4: Runaway Agent Loops and Cost

Agents may repeat actions, over-retrieve context, or consume excessive tokens while pursuing an underspecified goal.

Mitigation:

- Hard limits for turns, tool calls, tokens, time, cost, and manuscript scope
- Circular-action and duplicate-call detection
- Plain-language pre-flight estimates for large runs
- Visible pause and cancel controls
- Structured checkpoints that allow efficient resume
- Usage reporting separated by model inference, retrieval, skills, and tools

### Risk 5: Unsafe or Drifting Capabilities

Generated tools or skills may contain errors, request excessive permissions, behave differently after modification, or produce provider-specific results.

Mitigation:

- Explicit production approval before installation or modification
- Schema validation, tests, sandboxing, versioning, and rollback
- Namespaced global and project scopes
- Least-privilege permissions and narrowly scoped session grants
- Model-neutral schemas with provider compatibility checks
- Immutable capability provenance and lifecycle history
- No agent authority to change its own installation or permission policy

## 17. Initial User Stories

### Project Setup

- As a novelist, I want to create a new Atlas project so I can begin planning a novel.
- As a novelist, I want Story Foundations to help me build a starter Codex without confronting me with a long form.
- As a novelist, I want a fast setup path so I can begin writing and deepen my Codex later.
- As a novelist, I want to import an existing manuscript so Atlas can help me extract story knowledge.

### Codex

- As a novelist, I want to create character bibles so my characters remain consistent.
- As a novelist, I want to mark private author notes so Atlas does not accidentally write them into prose.
- As a novelist, I want to approve AI-proposed Codex changes so the story canon remains under my control.
- As a novelist, I want to link Codex facts to manuscript passages so I can verify where details appear.

### Drafting

- As a novelist, I want Generator to draft from my scene outline so I can move from plan to prose faster.
- As a novelist, I want Generator to ask questions when my outline is vague so it does not invent the wrong thing.
- As a novelist, I want Generator to use prior chapter summaries so later chapters remain consistent.
- As a novelist, I want Atlas to resume where I stopped so I can recover momentum quickly.
- As a novelist, I want distraction-free mode to queue agent responses until I finish focusing.

### Dialogue

- As a novelist, I want Dialogue Editor to check whether each character sounds distinct.
- As a novelist, I want alternate dialogue suggestions with different tension levels.
- As a novelist, I want dialogue feedback that considers subtext and action beats.

### Revision

- As a novelist, I want Story Editor to find structural problems across an act or full manuscript.
- As a novelist, I want Story Editor issues to have statuses so I can track revision progress.
- As a novelist, I want Line Editor to suggest tracked changes so I can review every sentence-level edit.
- As a novelist, I want every AI suggestion to use the same Accept, Reject, and Refine actions.
- As a novelist, I want accepted AI changes to remain reversible.

### Navigation and Accessibility

- As a novelist, I want a command palette so I can navigate and invoke tools without leaving the keyboard.
- As a novelist, I want scalable manuscript text and high-contrast controls so long writing sessions remain comfortable.
- As a novelist, I want reduced-motion support so interface movement does not interfere with my work.

### Story Insight

- As a novelist, I want to view my story timeline so I can spot chronology and continuity problems.
- As a novelist, I want optional writing goals and history so I can track momentum without feeling judged.

### Privacy and Models

- As a novelist, I want to choose which model each agent uses so I can balance quality, cost, and privacy.
- As a novelist, I want to mark sensitive material local-model-only.
- As a novelist, I want to inspect what context was sent to an LLM.

### Agents, Tools, and Skills

- As a novelist, I want every writing agent to use the same library format regardless of model provider.
- As a novelist, I want to see which tools and skills an agent used without reading hidden model reasoning.
- As a novelist, I want global capabilities for workflows I reuse and project capabilities for story-specific work.
- As a novelist, I want to create my own capability or promote a useful project capability for reuse across projects.
- As a novelist, I want Atlas to recommend a reusable capability when it notices a repeated process.
- As a novelist, I want to review and approve generated tools or skills before they are installed in production.
- As a novelist, I want Atlas to choose between a deterministic tool and a prompt-based skill based on reliability, context preservation, and token efficiency.
- As a novelist, I want to test, disable, version, and roll back capabilities so my workflow remains dependable.
- As a novelist, I want sensitive actions authorized individually, with an option to approve the same narrowly scoped action for the current session.
- As a novelist, I want denied permissions to stop or redirect an agent without silently exposing my manuscript elsewhere.

## 18. Open Decisions for Later Phases

These decisions are not blockers for the clickable prototype but should be resolved before implementation phases.

- Exact frontend framework
- Exact backend framework
- Local database or file-first storage model
- Embedding provider
- Vector database or local vector index
- Backend vault implementation
- Exact OpenRouter integration pattern
- LM Studio connection strategy
- Exact internal agent runtime implementation and persistence strategy
- Capability package and manifest serialization format
- MCP client and server adapter boundaries
- Executable tool sandbox technology
- Definition and lifecycle of an Atlas authorization session
- Capability signing, trust levels, and third-party distribution roadmap
- Automated validation requirements by capability risk category
- Import parser strategy
- Export rendering pipeline
- Collaboration roadmap
- Final user-facing agent names and whether "Voice Coach" becomes an alternate mode of Dialogue Editor
- Final brand accent and bundled editor font set
- Text-to-speech provider and offline fallback strategy
- Beta-reader annotation formats beyond DOCX comments

## 19. Recommended Prototype Build Direction

For the first build, prioritize a polished desktop UI that proves the shape of the writing experience.

Recommended first-screen emphasis:

- A populated, partially drafted thriller sample project rather than an empty shell
- Manuscript editor in the center
- Outline and Codex navigation on the left
- One collapsed agent rail and comments on the right
- Momentum-first project dashboard and resume card accessible from navigation
- Command palette available from the top bar and keyboard shortcut
- Agent-routing visualization available as a settings or architecture tab

The prototype should make Atlas feel calm, literary, professional, and writer-centered. The one-minute understanding criterion is a formal Phase 1 acceptance test: a reviewer should recognize that Atlas is a structured novel-development environment with a living Codex, scene-aware drafting, specialized writing agents, and a manuscript that always remains central. Phase 2 should then make the agent architecture understandable: models are interchangeable reasoning engines, Atlas governs context and permissions, and a shared library of portable tools and skills gives the agents dependable ways to act.
