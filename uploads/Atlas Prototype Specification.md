# Atlas Prototype Specification

## 1. Product Summary

Atlas is a desktop-first writing application for solo novelists who want to develop, draft, revise, and polish long-form fiction with the help of specialized LLM-powered writing assistants. The application is designed for future published authors, especially writers working in thriller, crime/suspense, science fiction, and fantasy.

Atlas should feel like a serious writing app with integrated AI helpers, not a generic AI chat workspace. The manuscript remains the center of the experience, while the Codex, outline, scene metadata, revision comments, and AI tools support the writer's creative process.

The long-term product direction is to compete with tools such as Sudowrite, Novelcrafter, and Scrivener, while offering a more personalized, author-centered workflow.

## 2. Prototype Goal

The first prototype should demonstrate the user interface and core workflow before implementing functional AI behavior.

### Prototype Type

- Standalone web application
- Desktop-first design
- Clickable mockup
- UI flow first
- LLM orchestration visualization second
- No functional AI tools required in the first prototype phase
- Populated sample project as the default demonstration state

### Minimum Impressive Demo

The prototype should allow a user to move through the core Atlas experience:

1. Create or open a writing project.
2. View and edit a starter Codex.
3. Navigate book, part, chapter, and scene structure.
4. Work inside a manuscript editor.
5. Open sidebar AI assistants.
6. Highlight text and route it to an assistant.
7. View comments, tracked changes, or structured reports.
8. See a dashboard showing project progress, Codex completeness, unresolved issues, and drafting status.
9. Inspect a model-routing visualization showing how an assistant accesses model settings, the Codex, manuscript context, and tools.
10. Open the command palette to navigate or invoke an assistant.
11. Experience the guided Story Foundations onboarding flow.
12. View a static story timeline that connects scenes, characters, and plot events.

### Phase 1 Acceptance Criteria

- A first-time reviewer should understand within one minute that Atlas is a manuscript-centered writing environment with a living Codex and specialized assistants, not a generic chatbot.
- The default opening state should be a populated, partially drafted thriller project with a rich Codex, an open Story Editor report, and visible tracked changes.
- The manuscript, Codex, outline, and assistant relationship should be legible without explanation.
- Core prototype interactions should be clickable even when the underlying AI, retrieval, import, and export services are simulated.
- Advanced controls should not compete with the primary writing workflow in the default state.

### Experience and Design Direction

Atlas should evoke "The Writer's Study": warm, literary, quietly confident, and focused on sustained creative work.

Visual direction:

- Use warm paper tones such as `#FAF8F5` for light surfaces and deep warm charcoal such as `#1E1B18` for dark surfaces; avoid pure white and pure black.
- Present the manuscript as the page on the writer's desk, with a readable measure of approximately 65 to 70 characters, subtle page edges or elevation, and a comfortable top margin.
- Treat navigation and assistant panels as the desk around the page rather than decorative cards.
- Use one restrained brand accent, preferably deep ink blue or forest green. Avoid purple-led palettes and decorative gradients associated with generic AI products.
- Use semantic colors consistently: amber for tentative facts and warnings, red for contradictions and errors, and green for canon or resolved states.
- Use a manuscript serif such as Literata, Source Serif 4, or Charter, with two or three curated editor font choices. Use a humanist sans serif for interface text and tabular data.
- Default manuscript text should be approximately 18 to 20 pixels with a line height of at least 1.6.

Interaction direction:

- Use subtle 150 to 250 millisecond ease-out transitions for panels and state changes.
- Show quiet, non-blocking assistant activity outside the manuscript page; do not place loading spinners inside manuscript prose.
- Use restrained completion feedback for finishing a scene, chapter, session goal, or daily goal.
- Give each assistant a stable role icon and restrained accent tint, without mascots. Suggested metaphors include a nib for Generator, compass for Story Editor, loupe for Line Editor, quotation marks for Dialogue Editor, and globe for World Builder.
- Each assistant card should display its assigned model and current status.
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

In Phase 4, assistants may propose metadata based on the current draft, but the writer must approve changes.

## 6. Codex / Knowledgebase

The Codex is the central story knowledgebase. Its purpose is to maintain consistency, preserve author intent, and provide relevant context to Atlas assistants.

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

## 7. AI Assistant Tools

Atlas includes multiple specialized LLM connections. These tools are managed through OpenRouter, with support for commercial models and local LM Studio models.

User-facing assistant names should be concise and readable. Preserve the original names as internal aliases for prompts, configuration, and migration compatibility:

- Generator: `Generator`
- Story Editor: `Dev-Editor`
- Line Editor: `Line-Editor`
- Dialogue Editor: `Dialoguer`
- World Builder: `World-Builder`

### 7.1 Generator

Generator is the primary drafting assistant. It can create baseline text, fill in missing portions of a scene, continue existing prose, expand beats, and provide alternative versions.

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

## 8. LLM and Model Architecture

Atlas should route AI tool calls through OpenRouter so the writer can access commercial and open-source models.

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
- Configure model choice per tool.
- Edit system prompts as an advanced-user feature.
- Use local LM Studio models for privacy-sensitive projects.
- Set fallback behavior.

### Fallback Behavior

If an external model call fails, Atlas should fall back to local LM Studio models when configured.

### Token and Cost Tracking

Atlas should track:

- Token usage by project
- Token usage by chapter
- Token usage by tool
- Token usage by model
- Estimated cost by project
- Estimated cost by tool
- Estimated cost by model

Before any potentially expensive operation, Atlas should show a plain-language pre-flight estimate based on the selected model and context size. For example: "A full-manuscript Story Editor pass is estimated to cost $X to $Y." The writer must be able to confirm, change models, or cancel.

### Model Routing Visualization

The prototype should include a visual routing tab showing how an assistant request flows through the system.

The visualization may resemble a node-based workflow diagram similar to ComfyUI or Dify.

Example nodes:

- Selected assistant
- User selection or highlighted text
- Assistant prompt
- Tool settings
- Model selection
- OpenRouter
- LM Studio fallback
- Codex retrieval
- Manuscript context
- Chapter summaries
- Web search
- Response format
- Writer approval step

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
- AI tools sidebar
- Comments and revisions panel
- Command palette
- Story timeline
- Model routing visualization
- Settings
- Export panel

### Main Workspace Layout

Recommended desktop layout:

- Left sidebar: project navigation, outline, Codex quick access
- Center: manuscript editor
- Right sidebar: AI assistants, comments, tracked changes, context inspection
- Top bar: project controls, model status, export, command palette, distraction-free mode
- Bottom/status area: word count, scene status, token estimate, save state

### Progressive Disclosure and Advanced Mode

Atlas should follow the rule: "Nothing appears until the manuscript needs it."

New projects should open with the editor, left navigation, and one collapsed assistant rail. Scene metadata beyond Tier 1, fact-status controls, model routing, prompt editing, and multiple drafts should remain hidden until invoked.

An Advanced Mode toggle should expose:

- Editable system prompts
- Per-tool model selection
- Multiple draft management
- Detailed context inspection
- Routing and token diagnostics

Advanced Mode must not change manuscript content or project data; it changes only which controls are visible.

### Command Palette

`Cmd+K` on macOS and `Ctrl+K` on Windows and Linux should open a searchable command palette. It should support:

- Jumping to scenes, chapters, and Codex entries
- Invoking an assistant on the current selection or scene
- Toggling focus mode and themes
- Searching the manuscript
- Opening common project actions

### AI Tool Access

Tools should appear primarily as sidebar assistants.

Tools should also be callable inline through commands, such as:

- Send selected text to Story Editor
- Send selected text to Line Editor
- Send selected dialogue to Dialogue Editor
- Continue with Generator
- Check world consistency
- Propose Codex update

### AI Response Presentation

Response format depends on the tool:

- Generator: replacement text, inserted text, or tracked changes
- Line Editor: tracked changes
- Story Editor: structured report
- World Builder: comments, proposed Codex updates, or tracked changes
- Dialogue Editor: comments, alternate lines, or tracked changes

### Universal AI Suggestion Contract

Every assistant suggestion must:

- Be visually distinct from writer-authored manuscript text.
- Be attributed with the assistant's stable icon and accent tint.
- Offer the same primary actions: Accept, Reject, and Refine.
- Remain reversible after acceptance through undo and snapshot history.
- Provide a follow-up instruction field when the writer chooses Refine.

This contract applies to prose insertions, tracked changes, editorial findings, dialogue alternatives, metadata proposals, and Codex additions.

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

The workspace should display a clear save state such as "All changes saved - 2:14 PM" and provide a nearby entry point to snapshot history. Saving, syncing, and assistant processing must use distinct status language.

### Required UI Features

- Highlight text and send it to an assistant.
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
  exports/
  settings/
```

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

Audit logs for AI-generated changes are not required for the prototype.

## 13. Privacy and Authorization

Atlas should include privacy controls because unpublished manuscripts may be sent to commercial LLM providers.

### Required Privacy Features

- Notify the writer before sending manuscript content to an external provider.
- Require manual authorization before cloud model use.
- Allow Codex entries or chapters to be marked local-model-only.
- Warn the writer when using commercial cloud models with unpublished manuscript content.
- Store API keys in a backend vault rather than raw local files.

## 14. Prompt and Tool Configuration

Advanced users should be able to edit assistant prompts.

### Prompt Configuration Requirements

- Each assistant should have a curated default system prompt.
- Prompts should be editable in advanced settings.
- Prompt changes should be reversible.
- Prompt versions should be labeled.
- Tool prompts should indicate required context sources.
- Tool prompts should define expected output format.

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
- AI assistant sidebar with role icons, accent tints, model assignment, and status
- Comments and revisions panel
- Universal Accept, Reject, and Refine suggestion pattern
- Command palette mockup
- Designed empty states
- Distraction-free mode mockup with queued assistant suggestions
- Static story timeline mockup
- Autosave trust signal and snapshot-history entry point
- Accessibility baseline, keyboard navigation, and reduced-motion states
- Export panel mockup
- Model routing visualization mockup

Not included:

- Functional LLM calls
- Functional OpenRouter integration
- Functional vector search
- Real manuscript import
- Real exports

### Phase 2: LLM Orchestration Prototype

Goal: Demonstrate how tool calls route through model settings, context retrieval, and response formatting.

Included:

- OpenRouter API configuration
- Per-tool model selection
- LM Studio fallback configuration
- Token and cost estimates
- Plain-language cost pre-flight for expensive operations
- Static or limited live assistant calls
- Context inspection panel
- Prompt editor
- Writer approval step for proposed Codex changes

### Phase 3: Codex and Retrieval Prototype

Goal: Make the Codex useful as a retrieval-backed story memory system.

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
- Assistant-proposed scene metadata with writer approval
- Keyboard-first suggestion review and batch actions
- Read-aloud with sentence highlighting
- Writing sprints and sprint summaries
- Complete Paper, Night, and Typewriter focus themes
- Plot-thread board, character presence map, and conflict/tension curve

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

AI assistants may invent story facts that conflict with the Codex.

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
- Sidebar assistants
- Progressive disclosure and an explicit Advanced Mode
- Tiered scene metadata
- Universal AI Suggestion Contract
- Default Codex fact status of canon
- Multiple drafts hidden behind activation
- Momentum-first dashboards and resume cues
- Designed, single-action empty states
- Focused distraction-free mode
- Tool-specific response formats

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
- As a novelist, I want distraction-free mode to queue assistant responses until I finish focusing.

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

- As a novelist, I want to choose which model each tool uses so I can balance quality, cost, and privacy.
- As a novelist, I want to mark sensitive material local-model-only.
- As a novelist, I want to inspect what context was sent to an LLM.

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
- Import parser strategy
- Export rendering pipeline
- Collaboration roadmap
- Final user-facing assistant names and whether "Voice Coach" becomes an alternate mode of Dialogue Editor
- Final brand accent and bundled editor font set
- Text-to-speech provider and offline fallback strategy
- Beta-reader annotation formats beyond DOCX comments

## 19. Recommended Prototype Build Direction

For the first build, prioritize a polished desktop UI that proves the shape of the writing experience.

Recommended first-screen emphasis:

- A populated, partially drafted thriller sample project rather than an empty shell
- Manuscript editor in the center
- Outline and Codex navigation on the left
- One collapsed assistant rail and comments on the right
- Momentum-first project dashboard and resume card accessible from navigation
- Command palette available from the top bar and keyboard shortcut
- Model-routing visualization available as a settings or architecture tab

The prototype should make Atlas feel calm, literary, professional, and writer-centered. The one-minute understanding criterion is a formal Phase 1 acceptance test: a reviewer should recognize that Atlas is a structured novel-development environment with a living Codex, scene-aware drafting, specialized revision assistants, and a manuscript that always remains central.
