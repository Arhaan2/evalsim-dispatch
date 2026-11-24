# Qwen dispatch pilot

This track uses Qwen3-4B-Instruct-2507 with a rank-four adapter on the output logits for eight action labels. Each turn serializes the operator's current public information and candidate tool calls. The quantized decoder produces a final hidden state and next-token logits. The adapter adds `B × A × h / sqrt(d)` to the eight selected vocabulary rows, with both matrices trained by episodic policy gradient. The base decoder stays frozen. Zero-initialized B reproduces the base policy. At deployment this is a constrained decoder with an external output head. It uses the same model and tool menu before and after training.

The menu assigns up to two earliest-deadline booking candidates from each yard and one slot each for inventory inquiry, route or supplier inquiry, replenishment, and waiting. Existing observation-based rules determine quantities. The operator selects a whole call by letter. A legal singleton is executed directly. The environment executes each call and independently verifies delivery and accounting.

The fixed protocol uses 24 groups of three on-policy trajectories. Each group shares its scenario, and a leave-one-out return baseline uses the other two trajectories. The optimizer maximizes terminal verified return with Adam. The final adapter and unmodified model are evaluated greedily on the same twenty new scenarios, alongside a hand-coded dispatcher. Four cases per family and one training seed make this a pilot. No supervised warm start or language-model curriculum ablation was run.

## Reproduce locally

The public web page replays recorded trajectories. The full inference experiment runs locally. The original run used a Mac with Apple silicon, 24 GB unified memory, Node 24.18.0, a C++17 compiler, and the llama.cpp macOS arm64 release. The source, library and model versions are pinned. Keep downloads and run state outside this repository.

1. Get the [llama.cpp b12657 release](https://github.com/ggml-org/llama.cpp/releases/tag/b12657), including its corresponding source headers and arm64 macOS runtime. The published binary archive's SHA-256 is `109f2bc79945d74e3f7e02284a4474deeb05128bc24f2d8ca0e30229f90fe162`.
2. Download [Qwen3-4B-Instruct-2507-Q4_K_M.gguf at the pinned revision](https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/blob/a06e946bb6b655725eafa393f4a9745d460374c9/Qwen3-4B-Instruct-2507-Q4_K_M.gguf). The runner checks its SHA-256 against the [protocol](protocol.json). Model weights and the native runtime are separate downloads.
3. Build the helper, supply the GGUF, and run the experiment. Substitute paths to your extracted downloads. The output directory holds public JSON and the work directory holds resumable optimizer state.

```sh
sh training/language-model/build.sh /path/to/llama.cpp-source /path/to/llama-release /tmp/dispatch-encode
node training/language-model/run.mjs /tmp/dispatch-encode /path/to/model.gguf /tmp/dispatch-progress docs/data/llm
node training/language-model/audit.mjs
```

The runner hashes its source, protocol and world implementation. It checkpoints each training group and test case, and resumes compatible progress when invoked again. Device and library behavior can change floating-point results. The CPU-only audit replays every published action sequence and checks the final verified metrics. It does not rerun the model. [Original Qwen model card](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507)
