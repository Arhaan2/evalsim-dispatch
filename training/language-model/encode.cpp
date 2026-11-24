// Persistent llama.cpp worker. Each request is a decimal byte length plus LF and UTF-8 text.
// Only the last token produces output. The caller receives the unmodified next-token
// logits for A-H and the final hidden state used by the output-head adapter.
#include "llama.h"
#include "ggml-backend.h"
#include <algorithm>
#include <iomanip>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

static std::vector<llama_token> tokenize(const llama_vocab *vocab, const std::string &text, bool special) {
    std::vector<llama_token> out(text.size() + 8);
    const int count = llama_tokenize(vocab, text.data(), int(text.size()), out.data(),
                                     int(out.size()), false, special);
    if (count <= 0) throw std::runtime_error("Tokenization failed");
    out.resize(count);
    return out;
}

static void write_array(const float *data, int size) {
    std::cout << '[';
    for (int i = 0; i < size; ++i) {
        if (i) std::cout << ',';
        std::cout << data[i];
    }
    std::cout << ']';
}

int main(int argc, char **argv) {
    if (argc != 2) { std::cerr << "Usage: encode model.gguf\n"; return 2; }
    try {
        ggml_backend_load_all();
        llama_backend_init();
        auto mp = llama_model_default_params();
        mp.n_gpu_layers = -1;
        auto *model = llama_model_load_from_file(argv[1], mp);
        if (!model) throw std::runtime_error("Unable to load model");
        auto cp = llama_context_default_params();
        cp.n_ctx = 2048;
        cp.n_batch = 1024;
        cp.n_ubatch = 512;
        cp.embeddings = true;
        cp.pooling_type = LLAMA_POOLING_TYPE_NONE;
        auto *ctx = llama_init_from_model(model, cp);
        if (!ctx) throw std::runtime_error("Unable to create inference context");
        auto *vocab = llama_model_get_vocab(model);
        std::vector<llama_token> labels, previous;
        for (char c = 'A'; c <= 'H'; ++c) {
            auto tokens = tokenize(vocab, std::string(1, c), false);
            if (tokens.size() != 1) throw std::runtime_error("Expected single-token action labels");
            labels.push_back(tokens.front());
        }
        const int dimension = llama_model_n_embd_out(model);
        auto batch = llama_batch_init(1024, 0, 1);
        std::cout << std::setprecision(8);
        std::string line;
        while (std::getline(std::cin, line)) {
            const auto size = std::stoul(line);
            if (size > 65536) throw std::runtime_error("Prompt exceeds byte limit");
            std::string prompt(size, '\0');
            if (!std::cin.read(prompt.data(), size)) throw std::runtime_error("Incomplete prompt");
            auto tokens = tokenize(vocab, prompt, true);
            if (tokens.size() > 2048) throw std::runtime_error("Prompt exceeds context window");
            size_t prefix = 0;
            while (prefix + 1 < tokens.size() && prefix < previous.size() &&
                   tokens[prefix] == previous[prefix]) ++prefix;
            if (!llama_memory_seq_rm(llama_get_memory(ctx), 0, int(prefix), -1)) {
                llama_memory_clear(llama_get_memory(ctx), true);
                prefix = 0;
            }
            for (size_t start = prefix; start < tokens.size();) {
                const int count = int(std::min<size_t>(512, tokens.size() - start));
                batch.n_tokens = count;
                for (int i = 0; i < count; ++i) {
                    const auto pos = start + i;
                    batch.token[i] = tokens[pos];
                    batch.pos[i] = int(pos);
                    batch.n_seq_id[i] = 1;
                    batch.seq_id[i][0] = 0;
                    batch.logits[i] = pos + 1 == tokens.size();
                }
                if (llama_decode(ctx, batch) != 0) throw std::runtime_error("Forward pass failed");
                start += count;
            }
            const auto *logits = llama_get_logits_ith(ctx, -1);
            const auto *hidden = llama_get_embeddings_ith(ctx, -1);
            if (!logits || !hidden) throw std::runtime_error("Missing decoder output");
            std::vector<float> selected;
            for (auto token : labels) selected.push_back(logits[token]);
            std::cout << "{\"tokens\":" << tokens.size() << ",\"evaluated\":" << tokens.size() - prefix
                      << ",\"logits\":";
            write_array(selected.data(), int(selected.size()));
            std::cout << ",\"hidden\":";
            write_array(hidden, dimension);
            std::cout << "}\n" << std::flush;
            previous = std::move(tokens);
        }
        llama_batch_free(batch);
        llama_free(ctx);
        llama_model_free(model);
        llama_backend_free();
    } catch (const std::exception &e) {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
