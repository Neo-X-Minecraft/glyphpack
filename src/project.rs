//! Locate source-only build tools independently of the machine that compiled
//! the CLI. Encoding and injection do not need a checkout or external tools.
use std::{
    env,
    path::{Path, PathBuf},
};
fn checkout(path: &Path) -> bool {
    [
        "Cargo.toml",
        "src/encoder.rs",
        "crates/decoder-wasm/src/lib.rs",
    ]
    .iter()
    .all(|name| path.join(name).is_file())
}
fn resolve(explicit: Option<PathBuf>, current: &Path, embedded: &Path) -> Result<PathBuf, String> {
    if let Some(path) = explicit {
        return if checkout(&path) {
            std::fs::canonicalize(path).map_err(|e| e.to_string())
        } else {
            Err("GLYPHPACK_ROOT must point to a GlyphPack source checkout".into())
        };
    }
    for path in current.ancestors().chain(std::iter::once(embedded)) {
        if checkout(path) {
            return std::fs::canonicalize(path).map_err(|e| e.to_string());
        }
    }
    Err("This command needs a GlyphPack source checkout. Run it from that checkout or set GLYPHPACK_ROOT. Encoding and injection work without one.".into())
}
/// Prefer an explicit checkout, then the current directory or its ancestors.
/// The compile-time path is only a convenience fallback for local cargo runs.
pub fn root() -> Result<PathBuf, String> {
    resolve(
        env::var_os("GLYPHPACK_ROOT").map(PathBuf::from),
        &env::current_dir().map_err(|e| e.to_string())?,
        Path::new(env!("CARGO_MANIFEST_DIR")),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn relocated_binary_prefers_checkout_and_rejects_invalid_override() {
        let folder = env::temp_dir().join(format!("glyphpack-root-{}", std::process::id()));
        std::fs::create_dir_all(folder.join("crates/decoder-wasm/src")).unwrap();
        std::fs::create_dir_all(folder.join("src/subdir")).unwrap();
        for name in [
            "Cargo.toml",
            "src/encoder.rs",
            "crates/decoder-wasm/src/lib.rs",
        ] {
            std::fs::write(folder.join(name), "").unwrap();
        }
        let expected = std::fs::canonicalize(&folder).unwrap();
        assert_eq!(
            resolve(
                None,
                &folder.join("src/subdir"),
                Path::new("/missing-build-machine-path")
            )
            .unwrap(),
            expected
        );
        assert_eq!(
            resolve(Some(folder.clone()), Path::new("/"), Path::new("/missing")).unwrap(),
            expected
        );
        assert!(resolve(Some(folder.join("missing")), &folder, &folder)
            .unwrap_err()
            .contains("GLYPHPACK_ROOT"));
        assert!(resolve(None, Path::new("/missing"), Path::new("/missing"))
            .unwrap_err()
            .contains("source checkout"));
        std::fs::remove_dir_all(folder).unwrap();
    }
}
