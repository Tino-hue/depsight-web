///| moon.mod（TOML 简化语法）/ moon.mod.json 解析。

///|
/// 解析 moon.mod（TOML 简化）或 moon.mod.json
fn parse_mod_text(text : String) -> Result[Module, String] {
  let trimmed = text.trim().to_owned()
  if trimmed.has_prefix("{") {
    parse_mod_json(trimmed)
  } else {
    parse_mod_toml(trimmed)
  }
}

///|
/// 解析 moon.mod.json
fn parse_mod_json(text : String) -> Result[Module, String] {
  let json = @json.parse(text) catch { _ => return Err("Invalid JSON in moon.mod.json") }
  guard json is Object(obj) else { return Err("Expected JSON object in moon.mod.json") }

  let name = match obj.get("name") {
    Some(String(s)) => s
    _ => "unknown"
  }
  let version = match obj.get("version") {
    Some(String(s)) => s
    _ => "0.0.0"
  }
  let license = match obj.get("license") {
    Some(String(s)) => Some(s)
    _ => None
  }
  let deps : Map[String, String] = Map([])
  match obj.get("deps") {
    Some(Object(d)) => {
      for pair in d {
        let (k, v) = pair
        guard v is String(ver) else { continue }
        let (dep_name, _) = split_dep_name(k)
        deps[dep_name] = ver
      }
    }
    _ => ()
  }

  Ok(Module::{ name, version, license, deps })
}

///|
/// 解析 moon.mod（TOML 简化语法）
fn parse_mod_toml(text : String) -> Result[Module, String] {
  let result = Module::{ name: "unknown", version: "0.0.0", license: None, deps: Map([]) }
  let mut in_import = false

  for raw in text.split("\n") {
    let line = strip_toml_comment(raw)
    if line.is_empty() { continue }

    if line.has_prefix("name") && line.contains("=") {
      result.name = strip_quotes(toml_value(line))
    } else if line.has_prefix("module") && !line.contains("=") {
      // 头部行：`module my/app`（等价于 name = "my/app"）
      result.name = line["module".length():].trim().to_owned()
    } else if line.has_prefix("version") && line.contains("=") {
      result.version = strip_quotes(toml_value(line))
    } else if line.has_prefix("license") && line.contains("=") {
      result.license = Some(strip_quotes(toml_value(line)))
    } else if line.has_prefix("import") {
      if line.contains("{") {
        // 块形式：import { ... }（可能跨多行）
        in_import = true
        match extract_brace_content(line) {
          Some(content) => {
            add_imports(result.deps, content)
            in_import = false
          }
          None => ()
        }
      } else {
        // 旧版单行形式：import "x@1.0"（平台条件 import "x" for "wasm" 跳过）
        in_import = false
        if !line.contains(" for ") {
          match extract_quoted(line) {
            Some(dep_str) => {
              let (n, v) = split_dep_name(dep_str)
              result.deps[n] = v
            }
            None => ()
          }
        }
      }
    } else if in_import && line.contains("}") {
      // 多行 import 块的收尾行（无字符串）
      in_import = false
    } else if in_import && line.contains("\"") {
      // 多行 import 里的字符串
      match extract_quoted(line) {
        Some(dep_str) => {
          let (n, v) = split_dep_name(dep_str)
          result.deps[n] = v
        }
        None => ()
      }
      if line.contains("}") { in_import = false }
    }
  }

  Ok(result)
}

///|
/// 剥离行内 `#` 注释（引号感知：字符串字面量内的 # 不算注释）。
/// TOML 基本字符串 "..." 与字面字符串 '...' 都会进入字符串状态，支持 \" 转义。
fn strip_toml_comment(line : StringView) -> String {
  let mut in_str = false
  let mut quote = '"'
  let mut i = 0
  while i < line.length() {
    let c : Char = line[i].unsafe_to_char()
    if in_str {
      if c == '\\' && quote == '"' {
        i = i + 2
        continue
      }
      if c == quote { in_str = false }
    } else if c == '"' || c == '\'' {
      in_str = true
      quote = c
    } else if c == '#' {
      return line[:i].trim().to_owned()
    }
    i = i + 1
  }
  line.trim().to_owned()
}

///|
/// 取 `key = value` 中 `=` 右侧原文
fn toml_value(line : String) -> String {
  match line.find("=") {
    Some(eq) => line[eq+1:].trim().to_owned()
    None => ""
  }
}

///|
/// 从 "pkg@1.0" 拆分（@ 取最后一个，兼容 scope 名）
fn split_dep_name(s : String) -> (String, String) {
  match s.rev_find("@") {
    Some(at) if at > 0 => (s[:at].to_owned(), s[at+1:].to_owned())
    _ => (s, "latest")
  }
}

///|
/// 去掉首尾引号
fn strip_quotes(s : String) -> String {
  let t = s.trim().to_owned()
  if t.has_prefix("\"") && t.has_suffix("\"") && t.length() >= 2 {
    t[1:t.length()-1].to_owned()
  } else if t.has_prefix("'") && t.has_suffix("'") && t.length() >= 2 {
    t[1:t.length()-1].to_owned()
  } else {
    t
  }
}

///|
/// 提取 { ... } 中的内容
fn extract_brace_content(line : String) -> String? {
  match line.find("{") {
    Some(start) =>
      match line.rev_find("}") {
        Some(end) if end > start =>
          Some(line[start+1:end].to_owned())
        _ => None
      }
    None => None
  }
}

///|
/// 提取 "..." 中的内容（第一个引号到最后一个引号之间）
fn extract_quoted(line : String) -> String? {
  match line.find("\"") {
    Some(start) =>
      match line.rev_find("\"") {
        Some(end) if end > start =>
          Some(line[start+1:end].to_owned())
        _ => None
      }
    None => None
  }
}

///|
/// 把 "pkg@1.0", "pkg2" 加入 deps
fn add_imports(deps : Map[String, String], content : String) -> Unit {
  // 简化：按逗号分割，再分别提取
  let parts = content.split(",")
  for part in parts {
    match extract_quoted(part.trim().to_owned()) {
      Some(s) => {
        let (n, v) = split_dep_name(s)
        deps[n] = v
      }
      None => ()
    }
  }
}
