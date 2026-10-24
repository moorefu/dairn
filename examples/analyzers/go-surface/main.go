// Optional PROJECT-owned Go AST analyzer, not part of Dairn QuickJS Core.
// Protocol: go run main.go <absolute-request.json> <absolute-response.json>
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

type Subject struct {
	Source string `json:"source_commit"`
	Base   string `json:"base_commit"`
}
type Request struct {
	Schema     string  `json:"schema"`
	AnalyzerID string  `json:"analyzer_id"`
	Domain     string  `json:"domain"`
	Subject    Subject `json:"subject"`
	Root       string  `json:"root"`
}
type Change struct {
	Path   string `json:"path"`
	Symbol string `json:"symbol"`
	Change string `json:"change"`
	Before string `json:"before"`
	After  string `json:"after"`
}
type Response struct {
	Schema     string   `json:"schema"`
	AnalyzerID string   `json:"analyzer_id"`
	Domain     string   `json:"domain"`
	Subject    Subject  `json:"subject"`
	Changes    []Change `json:"changes"`
}

func source(r Request, path string, old bool) ([]byte, error) {
	if old {
		if r.Subject.Base == "" {
			return nil, nil
		}
		out, err := exec.Command("git", "-C", r.Root, "show", r.Subject.Base+":"+path).Output()
		if err != nil {
			return nil, nil
		}
		return out, nil
	}
	full := filepath.Join(r.Root, filepath.FromSlash(path))
	info, err := os.Lstat(full)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("symlink forbidden")
	}
	return os.ReadFile(full)
}
func signatures(filename string, code []byte) (map[string]string, error) {
	out := map[string]string{}
	if len(code) == 0 {
		return out, nil
	}
	fset := token.NewFileSet()
	f, e := parser.ParseFile(fset, filename, code, parser.AllErrors)
	if e != nil {
		return nil, e
	}
	for _, d := range f.Decls {
		switch x := d.(type) {
		case *ast.FuncDecl:
			if !x.Name.IsExported() {
				continue
			}
			var b bytes.Buffer
			tp := &ast.FuncType{Func: token.NoPos, TypeParams: x.Type.TypeParams, Params: x.Type.Params, Results: x.Type.Results}
			if e := format.Node(&b, fset, tp); e != nil {
				return nil, e
			}
			name := "func:" + x.Name.Name
			if x.Recv != nil {
				name = "method:" + x.Name.Name
				var recv bytes.Buffer
				_ = format.Node(&recv, fset, x.Recv)
				name += recv.String()
			}
			out[name] = b.String()
		case *ast.GenDecl:
			for _, sp := range x.Specs {
				switch y := sp.(type) {
				case *ast.TypeSpec:
					if y.Name.IsExported() {
						var b bytes.Buffer
						_ = format.Node(&b, fset, y.Type)
						out["type:"+y.Name.Name] = b.String()
					}
				}
			}
		}
	}
	return out, nil
}
func run() error {
	if len(os.Args) != 3 {
		return errors.New("usage: analyzer request.json output.json")
	}
	raw, err := os.ReadFile(os.Args[1])
	if err != nil {
		return err
	}
	var r Request
	if err = json.Unmarshal(raw, &r); err != nil {
		return err
	}
	if r.Schema != "dairn.analyzer-request.v1" || r.Domain != "surface" || r.Root == "" || r.AnalyzerID == "" {
		return errors.New("invalid request")
	}
	if r.Subject.Base == "" {
		return errors.New("subject.base_commit required for AST diff")
	}
	cmd := exec.Command("git", "-C", r.Root, "diff", "--name-only", "--diff-filter=ACDMRT", r.Subject.Base, "--")
	data, err := cmd.Output()
	if err != nil {
		return err
	}
	result := Response{Schema: "dairn.surface-result.v1", AnalyzerID: r.AnalyzerID, Domain: r.Domain, Subject: r.Subject, Changes: []Change{}}
	count := 0
	for _, p := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		if p == "" || !strings.HasSuffix(p, ".go") || strings.Contains(p, "..") || filepath.IsAbs(p) {
			continue
		}
		count++
		if count > 100 {
			return errors.New("too many changed Go paths")
		}
		before, err := source(r, p, true)
		if err != nil {
			return err
		}
		after, err := source(r, p, false)
		if err != nil {
			return err
		}
		a, err := signatures(p, before)
		if err != nil {
			return fmt.Errorf("old %s: %w", p, err)
		}
		b, err := signatures(p, after)
		if err != nil {
			return fmt.Errorf("new %s: %w", p, err)
		}
		names := map[string]bool{}
		for x := range a {
			names[x] = true
		}
		for x := range b {
			names[x] = true
		}
		keys := []string{}
		for x := range names {
			keys = append(keys, x)
		}
		sort.Strings(keys)
		for _, x := range keys {
			if a[x] == b[x] {
				continue
			}
			typ := "changed"
			if _, ok := a[x]; !ok {
				typ = "added"
			}
			if _, ok := b[x]; !ok {
				typ = "removed"
			}
			result.Changes = append(result.Changes, Change{Path: p, Symbol: x, Change: typ, Before: a[x], After: b[x]})
		}
	}
	out, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(os.Args[2], append(out, '\n'), 0600)
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "analyzer error:", err)
		os.Exit(2)
	}
}
