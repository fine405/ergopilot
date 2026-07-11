# ErgoPilot Agent Runtime Resources

## Knowledge

- [Model Context Protocol: Architecture overview](https://modelcontextprotocol.io/docs/learn/architecture)
  MCP 官方架构说明。用于理解 host、client、server 以及 tools、resources、prompts
  分别解决什么问题。
- [Mastra: Using tools with agents](https://mastra.ai/docs/agents/mcp-guide)
  Mastra 官方工具与 MCP 指南。用于理解 schema 驱动的工具定义及 Agent 如何使用工具。
- [Mastra: Agent workflow guide](https://mastra.ai/articles/ai-agent-workflows)
  Mastra 官方工作流导读。用于理解 Agent 与确定性 workflow 的组合、暂停和恢复。
- [Cloudflare Workflows](https://developers.cloudflare.com/workflows/)
  官方持久工作流文档。用于理解 durable step、重试、等待审批和外部事件。
- [Cloudflare Workflows: Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)
  官方可靠性规则。用于理解为什么可重试步骤必须幂等，以及步骤应如何拆分。
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
  官方有状态计算文档。用于理解为什么每个工位需要一个实时协调单元。
- [AWS Builders' Library: Making retries safe with idempotent APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
  AWS 工程实践文章。用于理解 request identity、重复副作用和安全重试契约。
- [TanStack Start: Server Functions](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions)
  官方全栈执行边界说明。用于把熟悉的 React 调用映射到类型安全的服务端逻辑。
- [Hono documentation](https://hono.dev/docs)
  官方 Web Standards API 框架文档。用于理解控制平面的 HTTP、middleware 和类型契约。
- [AI Elements](https://elements.ai-sdk.dev/)
  官方 AI UI 组件目录。用于消息、工具状态、审批、任务和 checkpoint 的展示。
- [Tauri architecture](https://v2.tauri.app/concept/architecture/)
  官方桌面架构说明。用于理解 WebView、Rust backend 和消息传递的关系。
- [Tauri capabilities](https://v2.tauri.app/security/capabilities/)
  官方权限模型。用于学习桌面端最小权限和命令 scope。
- [The Rust Programming Language](https://doc.rust-lang.org/stable/book/)
  Rust 官方教材。优先阅读 ownership、enum、error handling、traits 和 concurrency，
  不要求从头通读后再开始项目。
- [Tokio tutorial](https://tokio.rs/tokio/tutorial)
  Tokio 官方异步教程。用于设备命令、事件流、超时、取消和 channel。
- [ROS 2: Topics, Services and Actions](https://docs.ros.org/en/jazzy/How-To-Guides/Topics-Services-Actions.html)
  ROS 2 官方接口比较。项目后期用来理解传感器 topic、查询 service 和长动作 action。
- [Gazebo: ROS 2 integration](https://gazebosim.org/docs/latest/ros2_integration/)
  Gazebo 官方集成说明。仅在确定性模拟器和设备协议稳定后使用。
- [Home Assistant: MQTT](https://www.home-assistant.io/integrations/mqtt)
  官方 MQTT 集成文档。用于第二个设备 adapter、发现、在线状态和 Birth/Last Will。

## Wisdom (Communities)

- [The Rust Programming Language Forum](https://users.rust-lang.org/)
  高质量 Rust 使用者论坛。用于 ownership、async、trait 设计和编译器错误的具体问题。
- [Open Robotics Discourse](https://discourse.ros.org/)
  ROS 官方社区讨论区。项目进入 ROS 2/Gazebo 阶段后用于验证接口和工程实践。
- [Cloudflare Developer Discord](https://discord.cloudflare.com/)
  Cloudflare 官方开发者社区。用于 Workflows、Durable Objects 和 Workers 的运行时问题。

## Gaps

- 尚未选定长期使用的 Mastra 社区渠道；在出现框架特定问题后再评估，避免过早增加信息源。
- 尚未选择真实硬件；在确定 MQTT 或 ROS 2 路线后再补相应设备社区。
