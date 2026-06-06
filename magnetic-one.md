Magentic-One: A Generalist Multi-Agent System
for Solving Complex Tasks
⋆ Adam Fourney, Gagan Bansal, Hussein Mozannar, Cheng Tan ⋆
† Eduardo Salinas, Erkang (Eric) Zhu, Friederike Niedtner, Grace Proebsting,
Griffin Bassman, Jack Gerrits, Jacob Alber, Peter Chang,
Ricky Loynd, Robert West, Victor Dibia †
⋄ Ahmed Awadallah, Ece Kamar, Rafah Hosn, Saleema Amershi ⋄
Microsoft Research AI Frontiers
Orchestrator
The attached image
contains a Python script.
Run the Python code
against an array of strings,
listed below. Output of the
script is a URL containing
C++ source code, compile,
run and return the sum of
the third and fifth integers ..
Task
Orchestrator creates a
dynamic/task-specific
plan
Coder
5
Analyze C++ code
ComputerTerminal
Execute code
3
ComputerTerminal
Execute code
6
FileSurfer
Access Image, extract code
1
Return final result
Task Complete!
Coder
2
Analyze Python code from image
Navigate to url, extract C++ code
WebSurfer
4
rosettacode.org
Figure 1: An illustration of the Magentic-One mutli-agent team completing a complex task
from the GAIA benchmark. Magentic-One’s Orchestrator agent creates a plan, delegates tasks
to other agents, and tracks progress towards the goal, dynamically revising the plan as needed.
The Orchestrator can delegate tasks to a FileSurfer agent to read and handle files, a WebSurfer
agent to operate a web browser, or a Coder or Computer Terminal agent to write or execute
code, respectively.
Abstract
Modern AI agents, driven by advances in large foundation models, promise to enhance
our productivity and transform our lives by augmenting our knowledge and capabilities.
To achieve this vision, AI agents must effectively plan, perform multi-step reasoning and
actions, respond to novel observations, and recover from errors, to successfully complete
complex tasks across a wide range of scenarios. In this work, we introduce Magentic-One,
a high-performing open-source agentic system for solving such tasks. Magentic-One uses
a multi-agent architecture where a lead agent, the Orchestrator, plans, tracks progress,
⋆: Research Leads, †: Core Contributors, ⋄: Program Leads. Contact: magentic-one@microsoft.com
1
arXiv:2411.04468v1 [cs.AI] 7 Nov 2024
and re-plans to recover from errors. Throughout task execution, the Orchestrator also directs other specialized agents to perform tasks as needed, such as operating a web browser,
navigating local files, or writing and executing Python code. Our experiments show that
Magentic-One achieves statistically competitive performance to the state-of-the-art on three
diverse and challenging agentic benchmarks: GAIA, AssistantBench, and WebArena. Notably, Magentic-One achieves these results without modification to core agent capabilities or
to how they collaborate, demonstrating progress towards the vision of generalist agentic systems. Moreover, Magentic-One’s modular design allows agents to be added or removed from
the team without additional prompt tuning or training, easing development and making it
extensible to future scenarios. We provide an open-source implementation of Magentic-One,
and we include AutoGenBench, a standalone tool for agentic evaluation. AutoGenBench
provides built-in controls for repetition and isolation to run agentic benchmarks in a rigorous and contained manner – which is important when agents’ actions have side-effects.
Magentic-One, AutoGenBench and detailed empirical performance evaluations of MagenticOne, including ablations and error analysis are available at https://aka.ms/magentic-one.
1 Introduction
Recent advances in artificial intelligence and foundation models are driving a renewed interest in
agentic systems that can perceive, reason, and act in the world to complete tasks on our behalf
[32, 59]. These systems promise to enhance our productivity by relieving us from mundane
and laborious tasks, and revolutionize our lives by augmenting our knowledge and capabilities
[16, 54, 6]. By leveraging the powerful reasoning and generative capabilities of large language
models (LLMs), agentic systems are already making strides in fields like software engineering
[66, 55], data analysis [4], scientific research [26, 7] and web navigation [79, 75].
Realizing the vision of agentic systems to transform our lives requires these systems to
not only achieve high performance in specific domains, but also to generalize to the diverse
range of tasks people may encounter throughout their day-to-day work and personal lives. In
this paper, we take steps towards creating such a generalist agentic system by introducing
Magentic-One.
1 Magentic-One uses a team ofagents, each specializing in generally-useful skills,
such as: operating a web browser, handling files, and executing code. The team is directed by
an Orchestrator agent which guides progress towards a high-level goal by iteratively planning,
maintaining working memory of progress, assigning tasks to other agents, and retrying upon
encountering errors. The Orchestrator uses two structured ledgers to achieve this and also
to decide which agent should take the next action. Together, Magentic-One’s agents achieve
strong performance on multiple challenging agentic benchmarks. Figure 1 shows an example of
Magentic-One solving one such benchmark task that requires multiple steps and diverse tools.
Key to Magentic-One’s performance is its modular and flexible multi-agent approach [51,
28, 53, 13, 52], implemented via the AutoGen2
framework [60]. The multi-agent paradigm
offers numerous advantages over monolithic single-agent approaches [51, 53, 6, 62], which we
believe makes it poised to become the leading paradigm in agentic development. For example,
encapsulating distinct skills in separate agents simplifies development and facilitates reusability,
akin to object-oriented programming. Magentic-One’s specific design further supports easy
adaptation and extensibility by enabling agents to be added or removed without altering other
agents, or the overall workflow, unlike single-agent systems that often struggle with constrained
and inflexible workflows.
To rigorously evaluate Magentic-One’s performance, we introduce AutoGenBench, an extensible standalone tool for running agentic benchmarks. AutoGenBench’s design enables repetition, isolation, and strong controls over initial conditions, so as to accommodate the variance
of stochastic LLM calls, and to isolate the side-effects of agents taking actions. Using AutoGen1The name Magentic-One is a combination of the words multi and agentic.
2
https://github.com/microsoft/autogen
2
Bench, we evaluated Magentic-One on three agentic benchmarks. We observed task-completion
rates of 38% on GAIA [29] and 32.8% on WebArena [79]; and attained an accuracy of 27.7%
on AssistantBench [71]. These results place Magentic-One in a strong position, where it is
statistically competitive with other state-of-the-art (SOTA) systems, including those that are
specialized for a given benchmark. Follow-up ablation experiments and in-depth error analyses
reveal the additive value of each agent to Magentic-One’s performance, and highlight opportunities for further improvement.
In summary, we contribute:
1. Magentic-One, a generalist multi-agent team with an open-source implementation. The
team consists of five agents: a Coder, Computer Terminal, File Surfer, Web Surfer, and
Orchestrator. Different agents can operate relevant tools such as stateful Web and file
browsers, as well as command line and Python code executors. The Orchestrator performs
several functions to guide progress towards accomplishing a high-level goal: it formulates
a plan, maintains structured working memory of progress, directs tasks to other agents,
restarts and resets upon stalling, and determines task completion.
2. AutoGenBench, a standalone tool for evaluating systems on agentic benchmarks, also
made available open-source.3 AutoGenBench handles configuring, running, and reporting
performance of agentic solutions while ensuring that all experiments start with well-known
initial conditions, and that agents cannot interfere with one another across runs.
3. Experimental results and analyses of Magentic-One’s performance on the GAIA, WebArena, and AssistantBench benchmarks, demonstrating strong task completion rates
which are statistically competitive with other SOTA systems. We also examine the contribution of individual agents and capabilities, and provide an error analysis to identify
the strengths and weaknesses of our multi-agent approach, along with opportunities for
improvement.
2 Related Work
Single-Agent Approaches. Recent advances in large language models (LLMs) such as GPT4 [33] have renewed interest in the development of autonomous agents that can solve tasks on
behalf of people [32, 59, 16, 60, 65, 49, 74, 43]. These modern agents have shown remarkable
skills in software development [55, 76, 66, 63], web manipulation [8, 75, 79, 31, 1], manipulation
of general graphical user interfaces [73, 61, 3, 34], and other domains [37, 54].
Common strategies for developing such agents [25, 62, 27, 6] include equipping LLMs with
tools such as for code execution and web browsing [40, 41, 46, 29] and prompting strategies
for better reasoning and planning such as CoT [58], ReACT [70] and few-shot prompting [79].
With the development of multimodal models, agents can also operate in visual domains with
techniques such as Set-of-Marks prompting [67] among others [67, 77, 36, 14]. To allow agents to
accomplish tasks that require multiple steps with improved reliability, agent systems can incorporate self-critique [61, 34, 38], and inference-time search [5, 69, 19, 50]. Finally, Agentic systems
can also benefit from memory and training either through explicit fine-tuning [72, 34, 24, 39] or
through memory mechanisms [57, 49]. Our work incorporates a subset of these techniques, and
distributes them across agents in Magentic-One’s multi-agent workflow, resulting in a modular,
easy-to-extend implementation.
Multi-Agent Approaches. The multi-agent paradigm presents an attractive modular and
flexible approach to tackling complex tasks [51, 28, 12, 53, 45, 60, 52, 13, 25, 62, 27, 6]. Commonly each agent either has access to different tools or has a different role in the team, sometimes
3
https://aka.ms/agbench
3
defined through the system prompt of the LLM or by explicit training. Sibyl presents a multiagent approach with a debate-based jury mechanism with tools for python code execution and
web browsing [56]. WebPilot uses a multi-agent system with global and local optimization in
planning for web based tasks [75]. Trase claims to use a multi-agent architecture with a top
level agent with self-critique and lower level agents [42]. A host of other multi-agent systems
and frameworks have also been introduced [21, 22, 11, 2, 15]. However, the previous methods differ from the architecture of Magentic-One which incorporates dynamic routing between
agents using the Orchestrator along with planning and recovery.
Agentic Evaluation. To evaluate agents on general multi-step tasks, numerous benchmarks
have been proposed in the literature [30, 79, 64, 23, 71, 68, 47, 8, 35, 20]. Given the general
and ubiquitous nature of the web, many of these benchmarks heavily incorporate [29, 71],
or exclusively consider [79, 8] browser-based tasks. These benchmarks either rely on noninteractive traces through real websites such as Mind2Web [8], interaction with synthetically
created websites such as in WebArena [79], or interaction with real websites on the public
Internet such as GAIA [29]. In the former case, non-interactive benchmarks are limiting for
evaluating agentic systems since they do not allow agents to deviate from previously recorded
paths. This makes it impossible to evaluate error recovery, or find novel alternative strategies
for the given problem. Therefore, we focus on benchmarks that rely on interacting with live
websites – whether synthetic or public – as they are more faithful to real-world tasks. Moreover,
we prioritize benchmarks such as GAIA, which test generalist skills like data analysis or coding,
in addition to commanding web browsers to navigate pages. We contribute AutoGenBench as
a standalone tool to perform evaluation of agentic systems, relying on benchmarks from the
literature. Furthermore, we provide an in-depth error analysis of Magentic-One’s performance
contributing to work on debugging agentic systems [20].
3 Problem Setup
Complex Tasks. In this work our goal is to build a generalist agentic system capable of
solving complex tasks across a variety of domains. We define a task as complex if it requires,
or significantly benefits from, a process involving planning, acting, observing, and reflecting,
potentially multiple times. Acting refers to more than generating tokens, such as executing code,
using tools, or interacting in an environment. Observing, in this context, provides information
that was previously unavailable or unknowable. A task is defined by an input, a desired output
and an evaluation function to compare the desired output to any candidate output. The input
consists of a well-specified textual description and an optional arbitrary set of file attachments
which may include images, dataset files, audio clips among other things. For example, the input
task description could be “fact-check each claim in the attached PDF as correct or incorrect”
with a PDF file as an attachment. The desired output consists either of a textual answer
(possibly representing a structured object), or a specific state of the environment to reach. In
the fact-checking example, the output might be a string labeling each fact as correct or not,
e.g., “claim 1: correct, claim 2: incorrect, ...”. Here, the evaluation function might simply
determine whether the desired output and the proposed answer match exactly.
Agentic Systems. To complete a task, assume a computer which can be partially observed
and operated to complete the task. The computer constitutes the environment. An agentic
system can take as input the task description, and any related attachments that are present on
the computer environment. The system is allowed to do arbitrary processing to complete the
task, but must complete it within a time budget (e.g., 25 mins). For instance, on the computer,
the autonomous system can execute Python code, navigate the web using a browser, download
files locally, among other actions from its action space. The system’s ability to take action in,
4
Observe and act based on Orchestrator instruction
Agents
Coder ComputerTerminal WebSurfer FileSurfer
Report final answer or educated guess Task Complete!
Task Ledger
Create or update ledger
 Given or verified factz
 Facts to look uv
 Facts to derive
(computation or logicl
 Educated guesses
 Task plan
Progress Ledger
 Task complete®  Unproductive loops?  Is progress being
made®  What is the next speaker?   Next speaker instruction
Update progress ledger
Progress being
made?
Task
complete?
Stall count >
2
Yes
Yes
No
No
Yes
No
Orchestrator
Task
Write code and reason
to solve tasks
Execute code written by the
coder agent
Browse the internet (navigate
pages, fill forms, etc)
Navigate files (e.g.,
PDFs, pptx, WAV, etc)
Figure 2: Magentic-One features an Orchestrator agent that implements two loops: an outer
loop and an inner loop. The outer loop (lighter background with solid arrows) manages the task
ledger (containing facts, guesses, and plan). The inner loop (darker background with dotted
arrows) manages the progress ledger (containing current progress, task assignment to agents).
and potentially modify, both the local and web environments is why we refer to the system
as agentic. After completing the task, the system returns a text answer, and a trace of its
observations and steps along the way. The final state of the environment is also captured in
sufficient detail to run the task evaluation. Note that this setting can be described as a Partially
Observable Markov Decision Process, similar to formalizations used by prior work [49]. Nex, we
describe Magentic-One, our multi-agent system that can autonomously solve complex tasks.
4 Magentic-One Overview
Magentic-One is a generalist multi-agent system for autonomously completing complex tasks.
The team’s work is coordinated by an Orchestrator agent, responsible for task decomposition
and planning, directing other agents in executing subtasks, tracking overall progress, and taking corrective actions as needed. The other agents on the team are specialized with different
capabilities necessary for completing ad-hoc, open-ended tasks such as browsing the web and
interacting with web-based applications, handling files, and writing and executing Python code
(Figure 2).
5
Together, the Magentic-One team collaborates to solve tasks on behalf of a user. For example, suppose a user requests a survey and concise slide presentation of AI safety papers published
in the last month. Magentic-One will approach this task as follows. The Orchestrator will first
create a plan that breaks down the task into subtasks, such as searching for abstracts, downloading relevant papers, reading and summarizing the papers, and finally creating a presentation
out of the findings. This initial plan serves as providing a guide or rubric for acting, and may
not be followed exactly. Instead it can be interpreted as similar to chain of thought prompting
for the agents [58]. Once this initial plan is formed, the Orchestrator then selects an appropriate
agent and assigns it a subtask. For example, the WebSurfer agent might be directed to search
for and download AI safety papers, while the FileSurfer agent might be directed to open the
downloaded PDFs and extract relevant information. The Coder agent might create the presentation by writing Python code to interact with various files, and the ComputerTerminal agent
would then execute the code written to produce the final output (or to report execution errors
the coder agent has yet to address). As the task progresses, the Orchestrator coordinates the
agents, monitors progress, and monitors for task completion.
In the following sections, we first describe Magentic-One’s inter-agent workflow, driven by
the Orchestrator, then describe each individual agent’s design, capabilities, and action space.
4.1 Magentic-One’s Multi-Agent Workflow
Figure 2 illustrates Magentic-One’s workflow in more depth. At a high level, the workflow
contains two loops, the outer loop maintains the task ledger, which contains the overall plan,
while the inner loop maintains the progress ledger, which directs and evaluates the individual
steps that contain instructions to the specialized agents.
Outer Loop. The outer loop is triggered by an initial prompt or task. In response, the
Orchestrator creates the task ledger to serve as short-term memory for the duration of the task.
Upon receiving the task, the Orchestrator reflects on the request and pre-populates the task
ledger with vital information– given or verified facts, facts to look up (e.g., via web search),
facts to derive (e.g., programmatically, or via reasoning), and educated guesses. These initial
educated guesses are important, and can allow the Orchestrator to express memorized closedbook information in a guarded or qualified manner, allowing agents to potentially benefit, while
lessening the system’s overall sensitivity to errors or hallucinations. For example, agents might
only rely on the guesses when they get stuck, or when they run out of time and need to output
a best guess for the benchmark. Educated guesses are updated periodically, by the outer loop,
as new information becomes available.
Only after the facts and guesses in the task ledger have been populated, the Orchestrator
considers the makeup of the team it is directing. Specifically, it uses each team member’s
description, along with the current task ledger, to devise a step-by-step plan. The plan is
expressed in natural language and consists of a sequence of steps and assignments of those steps
to individual agents. Since the plan is used in a manner similar to chain of thought prompting
[58], it serves more as a hint for step-by-step execution – neither the Orchestrator nor the other
agents are required to follow it exactly. Since this plan may be revisited with each iteration of
the outer loop, we force all agents to clear their contexts and reset their states after each plan
update. Once the plan is formed, the inner loop is initiated.
Inner Loop. During each iteration of the inner loop, the Orchestrator answers five questions
to create the progress ledger:
• Is the request fully satisfied (i.e., task complete)?
• Is the team looping or repeating itself ?
6
• Is forward progress being made?
• Which agent should speak next?
• What instruction or question should be asked of this team member?
When answering these questions, the Orchestrator considers both the task ledger (containing
facts, guesses, and a plan), and the current agent conversation context.
The Orchestrator also maintains a counter for how long the team has been stuck or stalled.
If a loop is detected, or there is a lack of forward progress, the counter is incremented. As long
as this counter remains below a threshold (≤ 2 in our experiments), the Orchestrator initiates
the next team action by selecting the next agent and its instruction. However, if the counter
exceeds the threshold, the Orchestrator breaks from the inner loop, and proceeds with another
iteration of the outer loop. This includes initiating a reflection and self-refinement step [48],
where it identifies what may have gone wrong, what new information it learned along the way,
and what it might do differently on the next iteration of the outer loop. It then updates the
task ledger, revises the original plan, and starts the next cycle of inner loop. Together, this
counter-based mechanism gives the agents a limited budget to recover from small errors, or to
persist through brief episodes of uncertainty in progress.
This nested-loop behavior continues until the Orchestrator determines the task is complete
or the team has reached some (parameterized and configurable) termination logic, such as
reaching a maximum number of attempts, or exceeding a specified maximum time limit.
Finally, upon termination of both loops, the Orchestrator reviews the full transcript, along
with the ledger, and reports either a final answer, or its best educated guess.
4.2 Magentic-One’s Agents
The Orchestrator agent in Magentic-One coordinates with four specialized agents: WebSurfer,
FileSurfer, Coder and ComputerTerminal. As the names suggest, each of these agents is optimized for a specific – yet generally useful – capability. In most cases, these agents are constructed around LLMs with custom system prompts, and capability-specific tools or actions.
For example, WebSurfer can navigate to pages, click links, scroll the viewport, etc. In other
cases, agents may operate deterministically, and do not include LLMs calls at all. For example,
the ComputerTerminal deterministically runs Python code, or shell commands, when asked.
This decomposition of high-level capabilities across agents, and low-level actions within
agents, creates a hierarchy over tool usage which may be easier for the LLMs to reason about.
For example, rather than deciding between dozens of possible actions, the Orchestrator needs
only to decide which agent to call to access a broad capability (e.g., browsing the web). The
chosen agent then selects from a limited set of agent-specific actions (e.g., clicking a button
versus scrolling the page).
We detail the implementation of each of the agents below:
• WebSurfer: This is a highly specialized LLM-based agent that is proficient in commanding and managing the state of a Chromium-based web browser. With each incoming
natural-language request, the WebSurfer maps the request to a single action in its action
space (described below), then reports on the new state of the web page (providing both a
screenshot and a written description). As an analogy, this configuration resembles a telephone technical support scenario where the Orchestrator knows what to do, but cannot
directly act on the web page. Instead it relays instructions, and relies on the WebSurfer
to carry out actions and report observations.
The action space of the WebSurfer includes navigation (e.g. visiting a URL, performing a
web search, or scrolling within a web page); web page actions (e.g., clicking and typing);
and reading actions (e.g., summarizing or answering questions). This latter category of
7
reading actions allows the WebSurfer to directly employ document Q&A techniques in the
context of the full document. This saves considerable return-trips to the orchestrator (e.g.,
where the orchestrator might simply command the agent to continue scrolling down), and
is advantageous for many tasks.
When interacting with web page elements (e.g., when clicking or typing), the WebSurfer
must ground the actions to specific coordinates or elements of the current web page. For
this we use set-of-marks prompting [67] in a manner similar to Web Voyager[14]. This
step relies on an annotated screenshot of the page, and thus is inherently multi-modal.
We further extended the set-of-marks prompt to include textual descriptions of content
found outside the visible view port, so that the agent can determine what might be found
by scrolling 4
, or opening menus or drop-downs.
• FileSurfer: The FileSurfer agent is very similar to the WebSurfer, except that it commands a custom markdown-based file preview application rather than a web browser. This
file preview application is read-only, but supports a wide variety of file types, including
PDFs, Office documents, images, videos, audio, etc. The FileSurfer can also perform common navigation tasks such as listing the contents of directories, and navigating a folder
structure.
• Coder: This is an LLM-based agent specialized through its system prompt for writing
code, analyzing information collected from the other agents, or creating new artifacts.
The coder agent can both author new programs and debug its previous programs when
presented with console output.
• ComputerTerminal: Finally, the ComputerTerminal provides the team with access to
a console shell where the Coder’s programs can be executed. ComputerTerminal can also
run shell commands, such as to download and install new programming libraries. This
allows the team to expand the available programming tool set, as needed.
Together, Magentic-One’s agents provide the Orchestrator with the tools and capabilities
that it needs to solve a broad variety of open-ended problems, as well as the ability to autonomously adapt to, and act in, dynamic and ever-changing web and file-system environments.
5 Experiments
5.1 AutoGenBench and Setup
Overview. Agentic systems, such as Magentic-One, that interact with stateful environments,
pose unique challenges for evaluation. For example, if a task requires installing a Python
library, the first system to be evaluated will be disadvantaged: Its agents will have to first
write Python code that fails, then debug the problem, install the library, and finally try again.
Subsequent runs – perhaps with other agents or models – will then benefit from the library’s
presence, and thus may appear to perform better simply because they were executed later.
Conversely, an erroneous agent could take actions (e.g. deleting files, or placing the the system
in an inoperable state), that would harm all future tasks. To this end, it is crucial that any
evaluation be independent across tasks, and provide safety from dangerous side effects (e.g.,
from agents’ actions).
To address this challenge, we developed AutoGenBenchfor evaluating agentic systems. Given
a benchmark, which consists of a set of independent tasks and associated evaluation functions,
4Scrolling is needed because, like human users, the WebSurfer agent cannot interact with page elements that
are outside the active viewport.
8
AutoGenBench allows users to run these tasks in a setting with tightly controlled initial conditions: in each task, AutoGenBench will start from a blank slate with freshly initialized Docker
containers, providing the recommended level of consistency and safety. The results of each task
are logged in a central location on the host machine (outside of Docker), and can be ingested
for analysis by metrics scripts. Furthermore, AutoGenBench allows users to launch multiple
tasks in parallel to speed up evaluation, or to compute variance across repeated runs.
Benchmarks. Using AutoGenBench, we can implement and evaluate Magentic-One on a
variety of benchmarks. Our criteria for selecting benchmarks is that they should involve complex
multi-step tasks, with at least some tasks or steps requiring planning and tool use ( including
using web browsers to act on real or simulated webpages, handling files, etc.) We consider three
benchmarks in this work that satisfy this criteria: GAIA, AssistantBench, and WebArena.
GAIA [29] is a benchmark for general AI assistants with 465 multi-modal question–answer
pairs that are real-world and challenging, requiring multiple steps and multiple tools to solve
(e.g., navigating the web, handling files, etc.). Despite the complexity of the tasks, GAIA
questions are designed to be automatically and unambiguously verifiable, with each answer
consisting of a target string that can be checked by string matching. GAIA is split into an
open validation set with 165 question–answer pairs, and a test set with 300 questions (answers
hidden).5 An example of a GAIA task follows:
Example GAIA task: Of the cities within the United States where U.S. presidents
were born, which two are the farthest apart from the westernmost to the easternmost
going east, giving the city names only? Give them to me in alphabetical order, in a
comma-separated list.
In order to solve this task, one needs to perform multiple steps: use the web to find the birth
city of each U.S. president, retrieve the coordinates of these cities, identify the westernmost
and easternmost coordinates, then return the corresponding cities in alphabetical order. This
requires web navigation, coding, and reasoning abilities, illustrating the complexity of GAIA.
The second benchmark we consider is AssistantBench [71]. Similar in design to GAIA, AssistantBench is a set of 214 question–answer pairs that are realistic, time-consuming (requiring
a human several minutes to perform), and automatically verifiable. They require navigating
real-world websites and multi-step reasoning. As with GAIA, answers are evaluated by string
matching, but AssistantBench introduces an additional softer metric of accuracy that affords
a degree of partial credit [71]. AssistantBench is split into an open validation set with 33
question–answer pairs and a test set with 181 questions (answers hidden).6 An example of an
AssistantBench task follows:
Example AssistantBench task: Which supermarkets within 2 blocks of Lincoln
Park in Chicago have ready-to-eat salad for under $15?
This task requires the agent to use an online map (e.g., Bing Maps) to find supermarkets near
Lincoln Park, and then, for each supermarket found, to navigate to its website and check if it
has ready-to-eat salads under $15.
The final benchmark we consider is WebArena [79], which involves performing complex tasks
in a synthetic web environment. Each task requires multi-step planning and acting, and targets
one or more fully functional synthetic websites. It contains 812 tasks across five major website
categories (e.g., shopping, forums, maps, etc.), and a sixth category that requires interacting
with multiple websites. Tasks are evaluated by running per-task evaluation scripts in the context
of the running website to check that answers exactly or approximately match a target, and that
the page is left in the desired state (e.g., that a comment has been posted, or an item is in a
5Leaderboard: https://gaia-benchmark-leaderboard.hf.space/
6Leaderboard: https://huggingface.co/spaces/AssistantBench/leaderboard
9
shopping cart). There is a public leaderboard for WebArena, but it is based on self-reported
results. 7 The dataset also provides no formal validation / test split across tasks [18]. We
developed our own split so that we might assess Magentic-One’s ability to generalize to tasks
in the unseen test set – which was evaluated only once. To split the tasks, we computed the
MD5 hash of each problem’s template id 8
, then assigned the 422 tasks with hashes starting
with digits 0-7 to the validation set (the remaining 390 tasks were assigned to the test set). An
example of a WebArena task, from the validation set, is as follows:
Example WebArena task: Tell me the count of comments that have received more
downvotes than upvotes for the user who made the latest post on the Showerthoughts
forum.
To solve this task, the agents have to navigate the Showerthoughts forum, find the profile of
the user with the latest post, retrieve all their comments, and finally count those with more
downvotes than upvotes. This illustrates the multi-step navigation nature of WebArena tasks.
Implementation Details. An identical configuration of Magentic-One was used for all three
benchmarks, but some additional set up code was needed for each. Namely, each benchmark
used a unique final prompt to ensure answers were expressed in the benchmark-specific prescribed format. Additionally, set up code for WebArena included instructions to log in to
websites, which is not considered part of the task. Finally, WebArena refers to the Postmill
website as Reddit,9
, causing agents to complain that they were on the wrong website. To address
this, we included the following prompt text:
“[This website is] a Postmill forum populated with a large sample of data crawled from
Reddit. Postmill is similar to Reddit, but the UI is distinct, and ’subreddits’ begin with /f/
rather than /r/ “
We include similar prompts for the three other WebArena sites, and we discuss this issue
more in section 6.3.
For Magentic-One, the default multimodal LLM we use for all agents (except the ComputerTerminal) is gpt-4o-2024-05-13. In a different configuration of Magentic-One, we experiment
with using OpenAI o1-preview10 for the outer loop of the Orchestrator and for the Coder,
while other agents continue to use GPT-4o. In this case, only a subset of the agents (e.g., the
WebSurfer) are multimodal since o1-preview can process only text as input. We implement
Magentic-One on the multi-agent platform AutoGen version 0.4 [60]. The code for MagenticOne is made publicly available.11 The experiments reported here were conducted between
August and October 2024.
5.2 Results
Results. Table 1 shows the performance of Magentic-One compared to relevant baselines for
all three benchmarks. For GAIA and AssistantBench, we report only results for the test sets.
For WebArena there is no common test set, so we report results for all 812 tasks. We separately
show performance of Magentic-One when using only GPT-4o as the model for all agents, and
when using a combination of GPT-4o and o1-preview.12 We also include the highest-performing
baselines in the literature, for each benchmark, according to the leaderboards as of October 21,
7Leaderboard: https://docs.google.com/spreadsheets/d/1M801lEpBbKSNwP-vDBkC_pF7LdyGU1f_ufZb_
NWNBZQ/edit
8WebArena tasks are populated by expanding a smaller number of task templates.
9WebArena’s Postmill website is populated from data crawled from Reddit
10https://openai.com/index/introducing-openai-o1-preview/
11https://aka.ms/magentic-one
12We do not report results for Magentic-One (GPT-4o, o1) on WebArena since the o1 model refused to complete
26% of WebArena Gitlab tasks, and 12% of Shopping Administration tasks, making a fair comparison impossible.
10
2024. This includes entries that are neither open-source, nor described by technical reports,
making them difficult to independently validate. Finally, we also include human performance
where available.
We use statistical tests to compare the performance of Magentic-One to baselines and say
that two methods are statistically comparable if the difference in their performance is not
statistically significant (α=0.05); details about our statistical methodology can be found in
Appendix A.
Magentic-One (GPT-4o, o1-preview) achieves statistically comparable performance to SOTA
methods on both GAIA and AssistantBench. On WebArena, only the GPT-4o variant was evaluated12, and it achieved comparable performance to most SOTA methods except for WebPilot
[75] and Jace.AI (which achieve statistically higher scores).
As noted earlier, WebArena does not have a hidden test set, thus posing some awkward
challenges for fair evaluation. To investigate this, we consider the self-imposed validation/test
splits that we created apriori. On the the validation set, Magentic-One correctly performed
35.1% of tasks (148 of 422), falling to 30.5% (119 of 390) for the test set. When setting up the
WebArena benchmark, we used the validation set to initially validate and debug our workflow.
This result suggests that extra attention paid on validation tasks has lead to at least mild
over-fitting. It is unclear whether other entries on the leaderboard performed similar analyses
or took similar precautions. We would encourage the WebArena authors to develop a hidden
test set for future comparison purposes.
Comparing Magentic-One (GPT-4o) and Magentic-One (GPT-4o, o1), the biggest gains
are observed on the GAIA benchmark. We hypothesize that this occurs because GAIA involves
tasks that require more logical reasoning and puzzle-solving compared to AssistantBench. These
are skills for which o1 was optimized.
Together, these results establish Magentic-One as a strong agentic system for completing
complex web- and file-based tasks. Moreover, achieving this level of performance across benchmarks speaks to the team’s generality – note that among the baselines in Table 1, no prior
system (other than base models) has been been evaluated across all three benchmarks.
Performance Breakdown by Task Difficulty or Domain Each benchmark provides some
categorization of tasks by difficulty (GAIA, AssistantBench), or application domain (WebArena). In Table 2, we breakdown performance by category, comparing Magentic-Oneto the
best-performing baselines for GAIA and AssistantBench, and to WebPilot [75], the best performing WebArena baseline for which category-level results are available.
By breaking down performance by category, we immediately notice that Magentic-One appears to compete better on hard tasks (e.g., level 3, hard) vs. easy tasks (e.g. level 1, easy).
In fact, on AssistantBench, Magentic-One outperforms the best comparable baseline on the
hardest category. Similarly, on WebArena, Magentic-One differs from WebPilot mainly on the
Reddit category – again the apparent easiest category by score.
We hypothesize that Magentic-One introduces some fixed overhead or complexity that disproportionately helps with long multi-step tasks, while introducing more opportunities for errors
on short few-step tasks. This presents an opportunity to enhance Magentic-One for simpler tasks
to achieve SOTA across all levels.
5.3 Ablations
In this section, we examine how different agents and capabilities contribute to Magentic-One’s
performance through ablation experiments.
Setup. On the validation set of GAIA [29], we perform multiple ablation experiments to evaluate the impact of key Magentic-One (GPT-4o) agents and components. First, to understand
11
Table 1: Performance of Magentic-One compared to relevant baselines on the test sets of GAIA,
WebArena and AssistantBench. For each method we note in parenthesis the LLM used to
obtain the result. The numbers reported denote exact task completion rate as a percentage.
All results for baselines are obtained from the corresponding benchmark leaderboard. We do
not report results for Magentic-One (GPT-4o, o1) on WebArena since the o1 model refused to
complete 26% of WebArena Gitlab tasks, and 12% of Shopping Administration tasks, making a
fair comparison impossible. An example task refused by o1 is “create a new group ”webagent”
with members pandey2000, sayakpaul, sayakpaul“. We include 95% error bars as ± using the
Wald interval method. We underline results that are statistically comparable to Magentic-One
(GPT-4o, o1) according to a z-test with α = 0.05, and bold results that statistically exceed our
performance (Appendix A).
Method GAIA AssistantBench
(EM)
AssistantBench
(accuracy)
WebArena
omne v0.1 (GPT-4o, o1) 40.53±5.6 – – –
Trase Agent v0.2 (GPT-4o, o1,
Gemini)
39.53±5.5 – – –
Multi Agent (NA) 38.87±5.5 – – –
das agent v0.4 (GPT-4o) 38.21±5.5 – – –
Sibyl (GPT-4o) [56] 34.55±5.4 – – –
HF Agents (GPT-4o) 33.33±5.3 – – –
FRIDAY (GPT-4T) [61] 24.25±4.8 – – –
GPT-4 + plugins [29] 14.60±4.0 – – –
SPA → CB (Claude) [71] – 13.8±5.0 26.4±6.4 –
SPA → CB (GPT-4T) [71] – 9.9±4.3 25.2±6.3 –
Infogent (GPT-4o) – 5.5±3.3 14.5±5.1 –
Jace.AI (NA) – – – 57.1±3.4
WebPilot (GPT-4o) [75] – – – 37.2±3.3
AWM (GPT-4) [57] – – – 35.5±3.3
SteP (GPT-4) [49] – – – 33.5±3.2
BrowserGym (GPT-4o) [10] – – – 23.5±2.9
GPT-4 6.67±2.8[29] 6.1 ±3.5[71] 16.5 ±5.4[71] 14.9±2.4[79]
Human 92.00±3.1 – – 78.2±2.8
Magentic-One (GPT-4o) 32.33±5.3 11.0 ±4.6 25.3 ±6.3 32.8±3.2
Magentic-One (GPT-4o, o1) 38.00±5.5 13.3 ±4.9 27.7 ±6.5 *
the impact of Magentic-One’s Orchestrator, the AutoGen[60] library’s GroupChat mechanism.
This baseline orchestrator simply decides which agent should speak next during task execution,
eliminating both ledgers, planning, progress tracking, loop detection, and explicit instructions
to other agents. The second set of ablations we perform is to remove individual agents from
the Magentic-One team to measure the impact of those agents on overall task performance.
For all ablations, we report on results broken down by difficulty level and capabilities required. For the capabilities analysis, we mapped the tools needed to complete tasks, as reported
by human annotators of the GAIA dataset [29], to four categories: web browsing, coding, file
handling, and none. These categories roughly correspond to the categories defined in [29],
with minor adjustments to better align to the core functional-responsibilities of Magentic-One’s
agents. For example, the original categories in [29] included a multi-modality category since
multi-modal task handling was accomplished via a tool. However, because Magentic-One leverages multi-modal models, multi-modality is handled inherently by all agents rather than through
12
Table 2: Performance comparison between Magentic-One (GPT-4o), Magentic-One (GPT-4o,
o1) and the best baseline for each benchmark’s test set. Analysis is split across the different
categories of each benchmark. Since there is no available baseline that evaluates on all three
benchmarks, we picked the best baseline with available results per benchmark. The best baseline
for GAIA is omne v0.1. The best baseline for WebArena with available category wise results is
WebPilot [75]. The best baseline for AssistantBench is SPA → CB (Claude) [71]. For WebArena,
top leaderboard methods [49, 75] consider the cross site tasks in WebArena as belonging to one
of the 5 sites, and so the comparison with Magentic-One may differ.
Dataset Category Magentic-One
(GPT-4o)
Magentic-One
(GPT-4o, o1)
Best Baseline [75,
71]
GAIA [29]
Level 1 46.24 54.84 53.76
Level 2 28.3 32.7 37.11
Level 3 18.75 22.92 26.53
AssistantBench [71]
Easy 69.9 73.4 81
Medium 35.6 47.1 44.6
Hard 16.9 14.8 13.3
WebArena [79]
Reddit 53.77 – 65.1
Shopping 33.16 – 36.9
CMS 29.1 – 24.7
Gitlab 27.78 – 39.4
Maps 34.86 – 33.9
Cross Site 14.6 – –
use of a specific tool. In such cases, we noted the task as requiring no tools (i.e., ’none’) to
complete. Our capability mapping is described further in Appendix B.
Results. In Figure 3a, we show the performance of different ablations of Magentic-One on the
GAIA validation set broken down by difficulty level. We find that the Orchestrator’s ledgers
are important to Magentic-One’s performance: without the full ledgers, performance drops by
31%. Likewise, we find that all four worker agents are important: removing any single agent
reduces performance by between 21% (Coder, Executor) to 39% (FileSurfer). For instance, the
FileSurfer is essential for the largest GAIA category, evel 2, where many questions include file
attachments. On the other hand, the WebSurfer is most essential for level 1 tasks.
Figure 3b shows ablation results broken down by required capabilities. In most cases,
removing an agent from Magentic-One results in a decrease in team performance on tasks
requiring corresponding capabilities. For example, Magentic-One with the FileSurfer removed
shows the worst performance on tasks requiring file handling. Similarly, Magentic-One without
the WebSurfer performs worst on tasks requiring web browsing.
Interestingly, through qualitative analysis of the ablation logs, we found several cases where
the Magentic-One agents compensated for missing capabilities in creative ways. For example,
when the Coder and ComputerTerminal agents were not available for a task that was expected
to require running code, the remaining agents solved the task by having the FileSurfer read
and reason over the code to predict the answer. In another example, when the FileSurfer was
unavailable for a task requiring reading contents of a pdf file, the remaining agents instead
attempted to find an online pdf viewer to solve the task.
5.4 Error Analysis
As a final element of evaluation, we conducted an analysis to better understand Magentic-One’s
current failure modes.
13
Magentic-One
(M1)
M1 w/ Simple
Orch
M1 -
WebSurfer
M1 -
FileSurfer
M1 - (Coder,
Terminal)
M1 - (Coder,
Terminal,
FileSurfer)
0
10
20
30
40
50
60
Number of Successful Tasks
Level 1
Level 2
Level 3
(a) Performance by Level
Magentic-One
(M1)
M1 w/ Simple
Orch
M1 -
WebSurfer
M1 -
FileSurfer
M1 - (Coder,
Terminal)
M1 - (Coder,
Terminal,
FileSurfer)
0
5
10
15
20
25
30
35
Number of Successful Tasks
web browsing
coding
file handling
no tools
(b) Performance by Capabilities
Figure 3: Performance of different ablations of Magentic-One (GPT-4o) on the GAIA development set measuring the number of correct tasks. In the first ablation we replace the Orchestrator with a simple Orchestrator. In the following ablations we remove individual agents from
Magentic-One denoted by “-agent”. The ablations show that all agents are essential to achieve
the best performance.
Approach. As Magentic-One works to solve tasks, it produces extremely rich and detailed
logs. Manual inspection of these logs often reveals mistakes, missed opportunities, dead-ends,
and run-time errors encountered by the agents. Many of these issues are systematic, suggesting
opportunities where the team could be improved. These opportunities could exist even when
14
the agents successfully complete a task e.g., because of suboptimal behavior. However, manual
inspection of these lengthy logs is slow and laborious, and scaling this manual labor to a large
number of logs can become cost-prohibitive.
To address this, we opted to automate log analysis using LLMs. The general problem here
is to automate the process of qualitative coding, i.e., automatically discovering major themes in
errors and inefficiencies observed in the logs. We implemented a multi-phase approach to accomplish this. For each task, we use GPT-4o to distill the team logs into a detailed postmortem
document, which seeks to identify the root cause of failure, along with any contributing factors.
These will serve as the basis for analysis.
Each root-cause document is then automatically assigned a few descriptive codes (aka labels)
using GPT-4o. With no pre-defined code book, there is initially a high diversity of codes across
documents. After generating thes
