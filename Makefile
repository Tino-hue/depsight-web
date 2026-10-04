# 编译 WASM 产物的 Makefile
# 需要 MoonBit 工具链：https://www.moonbitlang.cn/

.PHONY: wasm serve clean

# 编译 wasm-gc 产物并拷贝到 moonbit/depsight.wasm
wasm:
	moon build --target wasm-gc --release
	cp _build/wasm-gc/release/build/main/main.wasm moonbit/depsight.wasm
	@echo "✓ WASM 产物已生成：moonbit/depsight.wasm"

# 本地起服务（Windows 用 python，Mac/Linux 也可以用 python3）
serve:
	python -m http.server 8080

clean:
	rm -rf _build
