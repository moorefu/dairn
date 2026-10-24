---
name: dairn-tdd
description: Use for implementing behavior changes or repairing bugs when a stable test seam exists; drive narrow red-green behavior slices, avoid internal test coupling and verify real outputs.
dairn-stage: stable
---

# Tight Feedback / TDD

参考 `dairn.engineering.feedback`。确定一个能从外部行为证明问题的测试 seam；优先一个小的可运行切片。

1. 测试先失败（Red），记录精确命令与真实输出，预期来自原始需求/规格，不从被测算法复制。
2. 实现最小修复使同一信号通过（Green）。每轮一个切片，不写过度预设测试；最后完成标准/规格双轴 Review。
3. 当重现不可能或故障止损优先时说明限制，保留实际替代证据，不能伪造 Red 过程。
4. 不能把 mock 内部调用或没有发现测试当作业务正确性证据。可在 PR 引用测试，无需每次新建 feedback 文件。

## Behavior-driven vertical slices

Agree on the public seam under test. One red behavior assertion, smallest green change, repeat slice by slice. Never write assertions calculated by the implementation under test. Do not call a snapshot or a skipped test a passing behavioral check. Review-stage refactoring is separate from proving the behavior.
