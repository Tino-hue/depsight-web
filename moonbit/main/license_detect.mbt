///| LICENSE 文本指纹识别：发布包缺 metadata.license 时，从 LICENSE 文件内容推断 SPDX id。

///|
/// 从 LICENSE 文本推断 SPDX 许可证 id（识别失败返回 None）。
/// 判定基于 SPDX 标准许可证全文的关键特征串；匹配顺序保证 AGPL/LGPL 先于 GPL
/// （AGPL/LGPL 全文均包含 "GNU ... GENERAL PUBLIC LICENSE"）。
/// 注意 "UNLICENSED"（未授权）不等于 Unlicense，显式排除。
fn detect_license_from_text(text : String) -> String? {
  let upper = text.to_upper()

  // strong copyleft 家族（先长后短）
  if upper.contains("GNU AFFERO GENERAL PUBLIC LICENSE") {
    return if upper.contains("VERSION 3") {
      Some("AGPL-3.0")
    } else {
      Some("AGPL-1.0")
    }
  }
  if upper.contains("GNU LESSER GENERAL PUBLIC LICENSE") ||
    upper.contains("GNU LIBRARY GENERAL PUBLIC LICENSE") {
    return if upper.contains("VERSION 3") {
      Some("LGPL-3.0")
    } else {
      Some("LGPL-2.1")
    }
  }
  if upper.contains("GNU GENERAL PUBLIC LICENSE") {
    return if upper.contains("VERSION 3") {
      Some("GPL-3.0")
    } else {
      Some("GPL-2.0")
    }
  }
  if upper.contains("SERVER SIDE PUBLIC LICENSE") {
    return Some("SSPL-1.0")
  }

  // weak copyleft 家族
  if upper.contains("MOZILLA PUBLIC LICENSE") {
    return if upper.contains("2.0") {
      Some("MPL-2.0")
    } else {
      Some("MPL-1.1")
    }
  }
  if upper.contains("ECLIPSE PUBLIC LICENSE") {
    return if upper.contains("2.0") {
      Some("EPL-2.0")
    } else {
      Some("EPL-1.0")
    }
  }
  if upper.contains("EUROPEAN UNION PUBLIC LICEN") {
    return Some("EUPL-1.2")
  }
  if upper.contains("COMMON DEVELOPMENT AND DISTRIBUTION LICENSE") {
    return Some("CDDL-1.0")
  }

  // permissive 家族
  if upper.contains("APACHE LICENSE") || upper.contains("APACHE-2.0") {
    return Some("Apache-2.0")
  }
  if upper.contains("MIT LICENSE") ||
    upper.contains("PERMISSION IS HEREBY GRANTED") ||
    upper.contains("THE MIT LICENSE (MIT)") {
    return Some("MIT")
  }
  if upper.contains("BSD 3-CLAUSE") ||
    (upper.contains("REDISTRIBUTION AND USE") && upper.contains("NEITHER THE NAME")) {
    return Some("BSD-3-Clause")
  }
  if upper.contains("REDISTRIBUTION AND USE") {
    return Some("BSD-2-Clause")
  }
  if upper.contains("ISC LICENSE") || upper.contains("THE ISC LICENSE") {
    return Some("ISC")
  }
  if upper.contains("CREATIVE COMMONS ZERO") ||
    (upper.contains("CC0") && upper.contains("PUBLIC DOMAIN")) {
    return Some("CC0-1.0")
  }
  if upper.contains("WTFPL") {
    return Some("WTFPL")
  }
  if upper.contains("THE UNLICENSE") ||
    (upper.contains("UNLICENSE") && !upper.contains("UNLICENSED")) {
    return Some("Unlicense")
  }
  if upper.contains("ZLIB") {
    return Some("Zlib")
  }

  None
}
