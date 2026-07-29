package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
)

type card struct {
	Type string `json:"type"`
}
type player struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Role            string `json:"role"`
	General         string `json:"general"`
	HP              int    `json:"hp"`
	MaxHP           int    `json:"maxHp"`
	Hand            []card `json:"hand"`
	HandCount       int    `json:"handCount"`
	Weapon          string `json:"weapon"`
	Armor           string `json:"armor"`
	AttackHorse     string `json:"attackHorse"`
	DefenseHorse    string `json:"defenseHorse"`
	Treasure        string `json:"treasure"`
	FaceDown        bool   `json:"faceDown"`
	TreasureCards   []card `json:"treasureCards"`
	TreasureCardCount int `json:"treasureCardCount"`
}
type action struct {
	Type           string   `json:"type"`
	Label          string   `json:"label"`
	RequiresTarget bool     `json:"requiresTarget"`
	Targets        []string `json:"targets"`
}
type removableCard struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}
type cardSource struct {
	SourceID string `json:"sourceId"`
	Origin   string `json:"origin"`
	Label    string `json:"label"`
	Card     card   `json:"card"`
}
type interactionRequest struct {
	Kind                string       `json:"kind"`
	Reason              string       `json:"reason"`
	Sources             []cardSource `json:"sources"`
	Victims             []string     `json:"victims"`
	AllowPass           bool         `json:"allowPass"`
	AllowHandOverWeapon bool         `json:"allowHandOverWeapon"`
	PassLabel           string       `json:"passLabel"`
	Count               int          `json:"count"`
	Suits               []string     `json:"suits"`
}
type snapshot struct {
	CurrentPlayerID string      `json:"currentPlayerId"`
	Turn            int         `json:"turn"`
	Phase           string      `json:"phase"`
	GameOver        bool        `json:"gameOver"`
	Winner          interface{} `json:"winner"`
	Players         []player    `json:"players"`
}
type serverMessage struct {
	PlayerName          string                        `json:"playerName"`
	WaitTimeSeconds     int                           `json:"waitTimeSeconds"`

	Type                string                     `json:"type"`
	PlayerID            string                     `json:"playerId"`
	RoomSize            int                        `json:"roomSize"`
	Message             string                     `json:"message"`
	Players             []player                   `json:"players"`
	Snapshot            snapshot                   `json:"snapshot"`
	Actions             []action                   `json:"actions"`
	RemovableCards      map[string][]removableCard `json:"removableCards"`
	PendingDiscardCount int                        `json:"pendingDiscardCount"`
	Logs                []string                   `json:"logs"`
	Reason              string                     `json:"reason"`
	Effect              string                     `json:"effect"`
	Request             *interactionRequest        `json:"request"`
}

var input = bufio.NewScanner(os.Stdin)
var lastPlayers []player
var myPlayerID string

const reconnectMaxAttempts = 3

func choose(prompt string, count int) int {
	for {
		fmt.Print(prompt)
		if !input.Scan() {
			return -1
		}
		value, err := strconv.Atoi(strings.TrimSpace(input.Text()))
		if err == nil && value >= 1 && value <= count {
			return value - 1
		}
		fmt.Println("请输入有效编号")
	}
}

func send(writer *bufio.Writer, value interface{}) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if _, err = writer.Write(append(payload, '\n')); err != nil {
		return err
	}
	return writer.Flush()
}

func playerName(players []player, id string) string {
	for _, item := range players {
		if item.ID == id {
			return item.Name
		}
	}
	return id
}

func equipmentName(value string) string {
	if value == "" {
		return "无"
	}
	return value
}

func renderState(message serverMessage, writer *bufio.Writer) bool {
	lastPlayers = message.Snapshot.Players
	fmt.Printf("\n第 %d 回合 | %s\n", message.Snapshot.Turn, message.Snapshot.Phase)
	for _, line := range message.Logs {
		fmt.Printf("- %s\n", line)
	}
	fmt.Println("\n战场：")
	for _, item := range message.Snapshot.Players {
		marker := " "
		if item.ID == message.Snapshot.CurrentPlayerID {
			marker = ">"
		}
		hand := fmt.Sprintf("%d 张", item.HandCount)
		if item.Hand != nil {
			names := make([]string, len(item.Hand))
			for index, value := range item.Hand {
				names[index] = value.Type
			}
			hand = strings.Join(names, "、")
			if hand == "" {
				hand = "无"
			}
		}
		state := "正面"
		if item.FaceDown {
			state = "翻面"
		}
		fmt.Printf("%s %s [%s]  身份:%s  体力:%d/%d  手牌:%s  状态:%s\n", marker, item.Name, item.General, item.Role, item.HP, item.MaxHP, hand, state)
		fmt.Printf("  装备 | 武器:%s | 防具:%s | 进攻马:%s | 防御马:%s | 宝物:%s\n",
			equipmentName(item.Weapon), equipmentName(item.Armor), equipmentName(item.AttackHorse),
			equipmentName(item.DefenseHorse), equipmentName(item.Treasure))
		if item.TreasureCards != nil && len(item.TreasureCards) > 0 {
			names := make([]string, len(item.TreasureCards))
			for index, value := range item.TreasureCards {
				names[index] = value.Type
			}
			fmt.Printf("  木牛流马下:%s\n", strings.Join(names, "、"))
		}
	}
	if message.Snapshot.GameOver {
		fmt.Printf("\n游戏结束：%v\n", message.Snapshot.Winner)
		return true
	}
	if message.PendingDiscardCount > 0 {
		var me player
		for _, item := range message.Snapshot.Players {
			if item.ID == message.Snapshot.CurrentPlayerID {
				me = item
			}
		}
		usable := make([]string, 0, len(me.Hand)+len(me.TreasureCards))
		for _, value := range me.Hand {
			usable = append(usable, value.Type)
		}
		for _, value := range me.TreasureCards {
			usable = append(usable, value.Type+"（木牛流马）")
		}
		for index, label := range usable {
			fmt.Printf("%d. %s\n", index+1, label)
		}
		picked := choose(fmt.Sprintf("弃置一张牌（还需 %d 张）: ", message.PendingDiscardCount), len(usable))
		if picked >= 0 {
			_ = send(writer, map[string]interface{}{"type": "discard", "handIndex": picked})
		}
		return false
	}
	if len(message.Actions) == 0 {
		fmt.Println("\n等待其他玩家行动...")
		return false
	}
	fmt.Println("\n可执行动作：")
	for index, value := range message.Actions {
		fmt.Printf("%d. %s\n", index+1, value.Label)
	}
	actionIndex := choose("选择动作: ", len(message.Actions))
	if actionIndex < 0 {
		return true
	}
	selected := message.Actions[actionIndex]
	payload := map[string]interface{}{"type": "action", "actionIndex": actionIndex}
	if selected.Type != "end" && selected.RequiresTarget {
		for index, id := range selected.Targets {
			fmt.Printf("%d. %s\n", index+1, playerName(message.Snapshot.Players, id))
		}
		targetIndex := choose("选择目标: ", len(selected.Targets))
		if targetIndex < 0 {
			return true
		}
		targetID := selected.Targets[targetIndex]
		payload["targetId"] = targetID
		cards := message.RemovableCards[targetID]
		if len(cards) > 0 {
			for index, value := range cards {
				fmt.Printf("%d. %s\n", index+1, value.Label)
			}
			cardIndex := choose("选择目标的牌: ", len(cards))
			if cardIndex < 0 {
				return true
			}
			payload["selectedCardId"] = cards[cardIndex].ID
		}
	}
	_ = send(writer, payload)
	return false
}

func runGame(writer *bufio.Writer, scanner *bufio.Scanner, isReconnect bool) bool {
	if isReconnect {
		_ = send(writer, map[string]interface{}{"type": "reconnect", "playerId": myPlayerID, "version": 4})
	}
	for scanner.Scan() {
		var message serverMessage
		if err := json.Unmarshal(scanner.Bytes(), &message); err != nil {
			fmt.Println("收到无效消息")
			continue
		}
		switch message.Type {
		case "welcome":
			myPlayerID = message.PlayerID
			fmt.Printf("已加入房间，你的 ID：%s\n", message.PlayerID)
		case "reconnect_ok":
			myPlayerID = message.PlayerID
			fmt.Printf("已重连，你的 ID：%s\n", message.PlayerID)
		case "lobby":
			fmt.Printf("等待玩家（%d/%d）\n", len(message.Players), message.RoomSize)
		case "error":
			fmt.Printf("错误：%s\n", message.Message)
		case "closed":
			fmt.Println(message.Message)
			return true
		case "interaction":
			handleInteraction(message.Request, writer)
		case "effect":
			fmt.Printf("\n%s\n1. 发动\n2. 不发动\n", message.Reason)
			_ = send(writer, map[string]interface{}{"type": "effect", "enabled": choose("请选择: ", 2) == 0})
		case "player_disconnected":
			fmt.Printf("%s 已断线，%ds 内可重连\n", message.PlayerName, message.WaitTimeSeconds)
		case "player_reconnected":
			if message.PlayerName != "" {
				fmt.Printf("%s 已重连\n", message.PlayerName)
			}
		case "state":
			if renderState(message, writer) {
				return true
			}
		}
	}
	return false
}

func dialServer(host string, port int) (net.Conn, error) {
	hostValue := strings.TrimSpace(host)
	address := net.JoinHostPort(hostValue, strconv.Itoa(port))
	if ip := net.ParseIP(hostValue); ip != nil {
		return net.DialTCP("tcp", nil, &net.TCPAddr{IP: ip, Port: port})
	}
	return net.Dial("tcp", address)
}

func main() {
	host := flag.String("host", "127.0.0.1", "房主地址")
	port := flag.Int("port", 9527, "房间端口")
	name := flag.String("name", "玩家", "玩家名")
	flag.Parse()

	connection, err := dialServer(*host, *port)
	if err != nil {
		fmt.Printf("连接失败：%v\n", err)
		return
	}
	defer connection.Close()

	writer := bufio.NewWriter(connection)
	if err = send(writer, map[string]interface{}{"type": "join", "name": *name, "version": 4}); err != nil {
		fmt.Println(err)
		return
	}
	scanner := bufio.NewScanner(connection)

	// Main game loop with reconnection support
	gameOver := false
	for !gameOver {
		gameOver = runGame(writer, scanner, myPlayerID != "")
		if gameOver {
			break
		}
		// Connection lost — attempt reconnect
		if myPlayerID == "" {
			fmt.Println("连接中断")
			break
		}
		fmt.Println("连接中断，尝试重连...")
		reconnected := false
		for attempt := 1; attempt <= reconnectMaxAttempts; attempt++ {
			fmt.Printf("重连尝试 %d/%d...\n", attempt, reconnectMaxAttempts)
			connection.Close()
			newConn, dialErr := dialServer(*host, *port)
			if dialErr != nil {
				fmt.Printf("重连失败：%v\n", dialErr)
				continue
			}
			connection = newConn
			writer = bufio.NewWriter(connection)
			scanner = bufio.NewScanner(connection)
			reconnected = true
			fmt.Println("重连成功")
			break
		}
		if !reconnected {
			fmt.Println("重连失败次数过多，退出")
			break
		}
	}
}

func handleInteraction(request *interactionRequest, writer *bufio.Writer) {
	if request == nil {
		return
	}
	switch request.Kind {
	case "optional-effect":
		fmt.Printf("\n%s\n1. 发动\n2. 不发动\n", request.Reason)
		_ = send(writer, map[string]interface{}{"type": "interaction", "decision": map[string]interface{}{"choice": "effect", "enabled": choose("请选择: ", 2) == 0}})
	case "respond":
		fmt.Printf("\n%s\n", request.Reason)
		for index, source := range request.Sources {
			fmt.Printf("%d. %s\n", index+1, source.Label)
		}
		fmt.Printf("%d. 不应对\n", len(request.Sources)+1)
		picked := choose("请选择: ", len(request.Sources)+1)
		if picked >= 0 && picked < len(request.Sources) {
			_ = send(writer, map[string]interface{}{"type": "interaction", "decision": map[string]interface{}{"choice": "card", "sourceId": request.Sources[picked].SourceID}})
		} else {
			_ = send(writer, map[string]interface{}{"type": "interaction", "decision": map[string]interface{}{"choice": "pass"}})
		}
	case "collateral":
		fmt.Printf("\n%s\n", request.Reason)
		for index, victim := range request.Victims {
			fmt.Printf("%d. 对 %s 使用杀\n", index+1, playerName(lastPlayers, victim))
		}
		count := len(request.Victims)
		if request.AllowHandOverWeapon {
			fmt.Printf("%d. 交出武器\n", count+1)
			count++
		}
		picked := choose("请选择: ", count)
		if picked >= 0 && picked < len(request.Victims) {
			decision := map[string]interface{}{"choice": "target", "targetId": request.Victims[picked]}
			if len(request.Sources) > 1 {
				fmt.Println("选择用于响应的杀：")
				for index, source := range request.Sources {
					fmt.Printf("%d. %s\n", index+1, source.Label)
				}
				sourcePicked := choose("请选择: ", len(request.Sources))
				if sourcePicked >= 0 && sourcePicked < len(request.Sources) {
					decision["sourceId"] = request.Sources[sourcePicked].SourceID
				}
			}
			_ = send(writer, map[string]interface{}{"type": "interaction", "decision": decision})
		} else {
			_ = send(writer, map[string]interface{}{"type": "interaction", "decision": map[string]interface{}{"choice": "pass"}})
		}
	case "choose-suit":
		fmt.Printf("\n%s\n", request.Reason)
		suitLabels := map[string]string{"heart": "红桃", "diamond": "方片", "club": "梅花", "spade": "黑桃"}
		for index, suit := range request.Suits {
			label := suitLabels[suit]
			if label == "" {
				label = suit
			}
			fmt.Printf("%d. 声明%s\n", index+1, label)
		}
		suitPicked := choose("请选择: ", len(request.Suits))
		if suitPicked >= 0 && suitPicked < len(request.Suits) {
			_ = send(writer, map[string]interface{}{"type": "interaction", "decision": map[string]interface{}{"choice": "suit", "suit": request.Suits[suitPicked]}})
		} else {
			_ = send(writer, map[string]interface{}{"type": "interaction", "decision": map[string]interface{}{"choice": "pass"}})
		}
	case "choose-discard":
		fmt.Printf("\n%s\n", request.Reason)
		for index, source := range request.Sources {
			fmt.Printf("%d. %s\n", index+1, source.Label)
		}
		count := len(request.Sources)
		if request.AllowPass {
			passLabel := request.PassLabel
			if passLabel == "" {
				passLabel = "放弃"
			}
			fmt.Printf("%d. %s\n", count+1, passLabel)
			count++
		}
		picked := choose("请选择: ", count)
		if picked >= 0 && picked < len(request.Sources) {
			_ = send(writer, map[string]interface{}{"type": "interaction", "decision": map[string]interface{}{"choice": "card", "sourceId": request.Sources[picked].SourceID}})
		} else {
			_ = send(writer, map[string]interface{}{"type": "interaction", "decision": map[string]interface{}{"choice": "pass"}})
		}
	}
}
