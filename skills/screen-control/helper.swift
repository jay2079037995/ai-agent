import Cocoa
import Vision

// MARK: - Screen Info

func screenInfo() {
    guard let screen = NSScreen.main else {
        print("{\"error\":\"No screen found\"}")
        return
    }
    let frame = screen.frame
    let mouseLocation = NSEvent.mouseLocation
    // Convert from bottom-left (AppKit) to top-left (screen) coordinates
    let mouseY = frame.height - mouseLocation.y
    let result: [String: Int] = [
        "screenWidth": Int(frame.width),
        "screenHeight": Int(frame.height),
        "mouseX": Int(mouseLocation.x),
        "mouseY": Int(mouseY)
    ]
    if let data = try? JSONSerialization.data(withJSONObject: result),
       let json = String(data: data, encoding: .utf8) {
        print(json)
    }
}

// MARK: - Mouse Control

func mouseMove(x: Double, y: Double) {
    let point = CGPoint(x: x, y: y)
    guard let event = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved,
                               mouseCursorPosition: point, mouseButton: .left) else {
        print("ERROR: Failed to create mouse move event")
        return
    }
    event.post(tap: .cghidEventTap)
    print("OK")
}

func mouseClick(x: Double, y: Double, button: String) {
    let point = CGPoint(x: x, y: y)

    // Move mouse to position first
    if let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved,
                           mouseCursorPosition: point, mouseButton: .left) {
        move.post(tap: .cghidEventTap)
    }
    usleep(50_000) // 50ms settle time

    if button == "double" {
        // First click
        if let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown,
                               mouseCursorPosition: point, mouseButton: .left) {
            down.setIntegerValueField(.mouseEventClickState, value: 1)
            down.post(tap: .cghidEventTap)
        }
        if let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp,
                             mouseCursorPosition: point, mouseButton: .left) {
            up.setIntegerValueField(.mouseEventClickState, value: 1)
            up.post(tap: .cghidEventTap)
        }
        usleep(50_000)
        // Second click
        if let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown,
                               mouseCursorPosition: point, mouseButton: .left) {
            down.setIntegerValueField(.mouseEventClickState, value: 2)
            down.post(tap: .cghidEventTap)
        }
        if let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp,
                             mouseCursorPosition: point, mouseButton: .left) {
            up.setIntegerValueField(.mouseEventClickState, value: 2)
            up.post(tap: .cghidEventTap)
        }
    } else {
        let downType: CGEventType
        let upType: CGEventType
        let cgButton: CGMouseButton

        if button == "right" {
            downType = .rightMouseDown
            upType = .rightMouseUp
            cgButton = .right
        } else {
            downType = .leftMouseDown
            upType = .leftMouseUp
            cgButton = .left
        }

        if let down = CGEvent(mouseEventSource: nil, mouseType: downType,
                               mouseCursorPosition: point, mouseButton: cgButton) {
            down.post(tap: .cghidEventTap)
        }
        usleep(50_000)
        if let up = CGEvent(mouseEventSource: nil, mouseType: upType,
                             mouseCursorPosition: point, mouseButton: cgButton) {
            up.post(tap: .cghidEventTap)
        }
    }
    print("OK")
}

func mouseDrag(fromX: Double, fromY: Double, toX: Double, toY: Double) {
    let from = CGPoint(x: fromX, y: fromY)
    let to = CGPoint(x: toX, y: toY)

    // Move to start position
    if let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved,
                           mouseCursorPosition: from, mouseButton: .left) {
        move.post(tap: .cghidEventTap)
    }
    usleep(50_000)

    // Mouse down
    if let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown,
                           mouseCursorPosition: from, mouseButton: .left) {
        down.post(tap: .cghidEventTap)
    }
    usleep(100_000)

    // Smooth drag in steps
    let steps = 10
    for i in 1...steps {
        let t = Double(i) / Double(steps)
        let x = fromX + (toX - fromX) * t
        let y = fromY + (toY - fromY) * t
        let point = CGPoint(x: x, y: y)
        if let drag = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged,
                               mouseCursorPosition: point, mouseButton: .left) {
            drag.post(tap: .cghidEventTap)
        }
        usleep(20_000) // 20ms between steps
    }

    // Mouse up
    if let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp,
                         mouseCursorPosition: to, mouseButton: .left) {
        up.post(tap: .cghidEventTap)
    }
    print("OK")
}

func scroll(x: Double, y: Double, deltaY: Int32, deltaX: Int32) {
    let point = CGPoint(x: x, y: y)

    // Move mouse to scroll position
    if let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved,
                           mouseCursorPosition: point, mouseButton: .left) {
        move.post(tap: .cghidEventTap)
    }
    usleep(50_000)

    // Create scroll event
    if let scrollEvent = CGEvent(scrollWheelEvent2Source: nil, units: .line,
                                  wheelCount: 2, wheel1: deltaY, wheel2: deltaX, wheel3: 0) {
        scrollEvent.post(tap: .cghidEventTap)
    }
    print("OK")
}

// MARK: - OCR

func ocr(imagePath: String) {
    guard let image = NSImage(contentsOfFile: imagePath),
          let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        print("ERROR: Could not load image at \(imagePath)")
        return
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en"]
    request.usesLanguageCorrection = true

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    do {
        try handler.perform([request])
    } catch {
        print("ERROR: OCR failed - \(error.localizedDescription)")
        return
    }

    guard let results = request.results else {
        print("")
        return
    }

    var lines: [String] = []
    for observation in results {
        if let candidate = observation.topCandidates(1).first {
            lines.append(candidate.string)
        }
    }
    print(lines.joined(separator: "\n"))
}

// MARK: - Main

let args = Array(CommandLine.arguments.dropFirst())

guard let command = args.first else {
    fputs("Usage: helper <command> [args...]\n", stderr)
    fputs("Commands: info, move, click, drag, scroll, ocr\n", stderr)
    exit(1)
}

switch command {
case "info":
    screenInfo()

case "move":
    guard args.count >= 3, let x = Double(args[1]), let y = Double(args[2]) else {
        fputs("Usage: move <x> <y>\n", stderr)
        exit(1)
    }
    mouseMove(x: x, y: y)

case "click":
    guard args.count >= 3, let x = Double(args[1]), let y = Double(args[2]) else {
        fputs("Usage: click <x> <y> [left|right|double]\n", stderr)
        exit(1)
    }
    let button = args.count >= 4 ? args[3] : "left"
    mouseClick(x: x, y: y, button: button)

case "drag":
    guard args.count >= 5,
          let fx = Double(args[1]), let fy = Double(args[2]),
          let tx = Double(args[3]), let ty = Double(args[4]) else {
        fputs("Usage: drag <fromX> <fromY> <toX> <toY>\n", stderr)
        exit(1)
    }
    mouseDrag(fromX: fx, fromY: fy, toX: tx, toY: ty)

case "scroll":
    guard args.count >= 4,
          let x = Double(args[1]), let y = Double(args[2]),
          let dy = Int32(args[3]) else {
        fputs("Usage: scroll <x> <y> <deltaY> [deltaX]\n", stderr)
        exit(1)
    }
    let dx: Int32 = args.count >= 5 ? (Int32(args[4]) ?? 0) : 0
    scroll(x: x, y: y, deltaY: dy, deltaX: dx)

case "ocr":
    guard args.count >= 2 else {
        fputs("Usage: ocr <imagePath>\n", stderr)
        exit(1)
    }
    ocr(imagePath: args[1])

default:
    fputs("Unknown command: \(command)\n", stderr)
    exit(1)
}
