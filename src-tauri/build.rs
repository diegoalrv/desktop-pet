fn main() {
    // El puente Swift de screencapturekit enlaza el runtime de Swift del sistema (/usr/lib/swift).
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
        // ggml-metal (whisper) usa @available -> ___isPlatformVersionAtLeast; en release no se enlaza solo.
        let res = std::process::Command::new("clang").arg("--print-resource-dir").output().expect("clang");
        let dir = String::from_utf8_lossy(&res.stdout).trim().to_string();
        println!("cargo:rustc-link-search=native={dir}/lib/darwin");
        println!("cargo:rustc-link-lib=static=clang_rt.osx");
    }
    tauri_build::build()
}
