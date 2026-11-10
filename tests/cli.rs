//! Exercise the shipped executable from a directory unrelated to its build.
use std::{
    fs,
    io::Write,
    process::{Command, Stdio},
};
fn binary() -> Command {
    Command::new(env!("CARGO_BIN_EXE_glyphpack"))
}
#[test]
fn version_and_encoding_are_relocatable() {
    let version = binary().arg("--version").output().unwrap();
    assert!(version.status.success());
    assert_eq!(
        String::from_utf8(version.stdout).unwrap(),
        format!("GlyphPack {}\n", env!("CARGO_PKG_VERSION"))
    );
    let input: Vec<u8> = (0..4097).map(|i| (i * 73) as u8).collect();
    for mode in ["none", "fast", "secure"] {
        let mut child = binary()
            .current_dir(std::env::temp_dir())
            .env("GLYPHPACK_ROOT", "/this-is-not-a-checkout")
            .args(["encode", "-", "--checksum", mode, "--mask", "0"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(&input).unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success());
        let expected = glyphpack::encoder::dense16(
            &input,
            &glyphpack::encoder::EncodeOptions {
                integrity: glyphpack::encoder::Integrity::parse(mode).unwrap(),
                mask: Some(0),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(output.stdout, expected);
    }
}
#[test]
fn build_reports_invalid_checkout_without_spawning_tools() {
    let output = binary()
        .env("GLYPHPACK_ROOT", "/this-is-not-a-checkout")
        .args(["build", "--full"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("GLYPHPACK_ROOT"));
}
#[test]
fn injection_is_relocatable() {
    let folder = std::env::temp_dir().join(format!("glyphpack-cli-{}", std::process::id()));
    fs::create_dir_all(&folder).unwrap();
    fs::write(
        folder.join("template.html"),
        "<!doctype html><title>Test</title>__PAYLOAD__",
    )
    .unwrap();
    fs::write(folder.join("payload.utf16"), [32, 0, 33, 0]).unwrap();
    let output = binary()
        .current_dir(&folder)
        .env("GLYPHPACK_ROOT", "/this-is-not-a-checkout")
        .args(["inject", "template.html", "payload.utf16", "out.html"])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(fs::read(folder.join("out.html"))
        .unwrap()
        .starts_with(&[255, 254]));
    fs::remove_dir_all(folder).unwrap();
}
