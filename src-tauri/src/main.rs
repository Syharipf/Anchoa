// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let mut args = std::env::args_os();
    let _ = args.next();
    if args.next().as_deref() == Some(std::ffi::OsStr::new("agent")) {
        use std::io::Write;

        let args = args
            .map(|arg| arg.into_string())
            .collect::<Result<Vec<_>, _>>();
        let (code, output) = match args {
            Ok(args) => match anchoa_lib::cli::data_dir() {
                Ok(data_dir) => {
                    anchoa_lib::cli::run(&args, &data_dir, jiff::Timestamp::now().as_millisecond())
                }
                Err(error) => anchoa_lib::cli::error_output(error),
            },
            Err(_) => anchoa_lib::cli::error_output("Argumen harus berupa teks UTF-8"),
        };
        if std::io::stdout()
            .lock()
            .write_all(output.as_bytes())
            .is_err()
        {
            std::process::exit(2);
        }
        std::process::exit(code);
    }
    anchoa_lib::run()
}
